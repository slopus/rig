import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import { ProtocolHttpClient } from "../client/ProtocolHttpClient.js";
import { createEventIdFactory, type SessionEvent } from "../protocol/index.js";
import { modelOpenaiGpt55, modelOpenaiGpt56Sol } from "@slopus/rig-execution";
import { InMemorySessionStore } from "./InMemorySessionStore.js";
import type { PersistedSessionState } from "./InMemorySession.js";
import { PersistentSessionStore } from "./PersistentSessionStore.js";
import type { SessionStore } from "./SessionStore.js";
import { createProtocolHttpServer } from "./createProtocolHttpServer.js";
import type { FileSearchServiceContract } from "./FileSearchService.js";
import type { DockerExecutionConfig } from "../execution/index.js";
import type { GlobalEventQueue } from "./GlobalEventQueue.js";
import { TrackedTaskDrain } from "./TrackedTaskDrain.js";
import type { ProviderQuota } from "@slopus/rig-providers";

describe("createProtocolHttpServer", () => {
    it("broadcasts one fully configured message to every primary session", async () => {
        const store = new InMemorySessionStore();
        const first = store.create({ cwd: "/tmp/broadcast-first" });
        const second = store.create({ cwd: "/tmp/broadcast-second" });
        const firstSubmit = vi.spyOn(first, "submit");
        const secondSubmit = vi.spyOn(second, "submit");
        const { client, close } = await startServer({ store });
        try {
            const request = {
                all: true,
                externalTools: [
                    {
                        description: "Look up a ticket.",
                        name: "lookup_ticket",
                        parameters: { type: "object" },
                    },
                ],
                skills: [
                    {
                        description: "Check a release outside Rig.",
                        location: "durable",
                        name: "release-check",
                    },
                ],
                systemPrompt: "Exact broadcast prompt.",
                text: "Check the queue.",
            } as const;
            const response = await client.broadcastMessage(request);

            expect(response.submissions.map((submission) => submission.sessionId).sort()).toEqual(
                [first.id, second.id].sort(),
            );
            const { all: _all, ...message } = request;
            expect(firstSubmit).toHaveBeenCalledWith(message);
            expect(secondSubmit).toHaveBeenCalledWith(message);
            await expect(
                client.broadcastMessage({
                    sessionIds: [first.id, first.id],
                    text: "Do not submit this twice.",
                }),
            ).rejects.toThrow("unique");
            expect(firstSubmit).toHaveBeenCalledTimes(1);
        } finally {
            await first.abort();
            await second.abort();
            await close();
        }
    });

    it("lists and idempotently resolves external function calls through the integration API", async () => {
        const store = new PersistentSessionStore({ databasePath: ":memory:" });
        const state = pausedGoalState();
        store.saveSession(state);
        store.upsertExternalToolCall({
            arguments: { ticket: 42 },
            batchId: "batch-1",
            consumed: false,
            createdAt: 100,
            definition: {
                description: "Look up a ticket.",
                name: "lookup_ticket",
                parameters: { type: "object" },
            },
            id: "external-call-1",
            runId: "run-1",
            sessionId: state.id,
            status: "pending",
            toolCallId: "provider-call-1",
            toolCallIndex: 0,
        });
        const { client, close } = await startServer({ store });
        try {
            await expect(client.listPendingExternalToolCalls()).resolves.toMatchObject({
                calls: [{ id: "external-call-1", sessionId: state.id }],
            });
            await expect(client.listExternalToolCalls(state.id)).resolves.toMatchObject({
                calls: [{ id: "external-call-1", status: "pending" }],
            });
            await expect(
                client.resolveExternalToolCall(state.id, "external-call-1", {
                    output: "x".repeat(1_048_576),
                    status: "completed",
                }),
            ).rejects.toThrow("allowed limit");
            await expect(
                client.resolveExternalToolCall(state.id, "external-call-1", {
                    output: { state: "resolved" },
                    status: "completed",
                }),
            ).resolves.toMatchObject({ accepted: true, call: { status: "completed" } });
            await expect(
                client.resolveExternalToolCall(state.id, "external-call-1", {
                    output: { state: "resolved" },
                    status: "completed",
                }),
            ).resolves.toMatchObject({ accepted: false });
        } finally {
            await close();
            store.close();
        }
    });

    it("serves current quota from the session's configured provider", async () => {
        const sessionQuota = {
            capturedAt: 10,
            source: "codex" as const,
            windows: {
                fiveHour: {
                    capturedAt: 10,
                    resetsAt: 20,
                    status: "available" as const,
                    usedPercent: 32,
                },
                weekly: { status: "unavailable" as const },
            },
        };
        const getProviderQuota = vi.fn(async () => undefined);
        const { client, close, store } = await startServer({ getProviderQuota });
        try {
            const created = await client.createSession({ cwd: "/tmp/current-provider-quota" });
            const session = store.get(created.session.id);
            if (session === undefined) throw new Error("Expected the created session.");
            const providerQuota = vi
                .spyOn(session, "providerQuota")
                .mockResolvedValue(sessionQuota);

            await expect(client.getCurrentProviderQuota(created.session.id)).resolves.toEqual({
                currentProviderId: "codex",
                quota: sessionQuota,
            });
            expect(providerQuota).toHaveBeenCalledOnce();
            expect(getProviderQuota).not.toHaveBeenCalled();
        } finally {
            await close();
        }
    });

    it("unions session and project attachment sources and detaches them independently", async () => {
        const store = new InMemorySessionStore();
        store.registerSecret({
            description: "Service API credentials",
            environment: { SERVICE_TOKEN: "secret-value" },
            id: "service",
        });
        const { client, close } = await startServer({ store });
        try {
            const created = await client.createSession({ cwd: "/tmp/secret-project" });
            expect(created.session.secretIds).toEqual([]);

            await expect(client.attachSecret(created.session.id, "missing")).rejects.toThrow(
                "not registered",
            );
            const sessionAttached = await client.attachSecret(created.session.id, "service");
            expect(sessionAttached.session).toMatchObject({
                projectSecretIds: [],
                secretIds: ["service"],
                sessionSecretIds: ["service"],
            });

            const projectAttached = await client.attachSecret(
                created.session.id,
                "service",
                "project",
            );
            expect(projectAttached.session).toMatchObject({
                projectSecretIds: ["service"],
                secretIds: ["service"],
                sessionSecretIds: ["service"],
            });

            const sessionDetached = await client.detachSecret(created.session.id, "service");
            expect(sessionDetached.session).toMatchObject({
                projectSecretIds: ["service"],
                secretIds: ["service"],
                sessionSecretIds: [],
            });

            const projectDetached = await client.detachSecret(
                created.session.id,
                "service",
                "project",
            );
            expect(projectDetached.session).toMatchObject({
                projectSecretIds: [],
                secretIds: [],
                sessionSecretIds: [],
            });
            expect(
                store
                    .get(created.session.id)
                    ?.events.since(undefined)
                    ?.filter((event) => event.type === "secrets_changed")
                    .at(-1),
            ).toMatchObject({
                data: { projectSecretIds: [], secretIds: [], sessionSecretIds: [] },
            });
        } finally {
            await close();
        }
    });

    it("serves durable attributed usage and current-provider quota", async () => {
        const getProviderQuota = vi.fn(async () => undefined);
        const { client, close, store } = await startServer({ getProviderQuota });
        try {
            const created = await client.createSession({ cwd: "/tmp/usage-project" });
            const session = store.get(created.session.id);
            if (session === undefined) throw new Error("Expected the created session.");
            vi.spyOn(session, "providerQuota").mockResolvedValue({
                capturedAt: 10,
                source: "codex",
                windows: {
                    fiveHour: {
                        capturedAt: 10,
                        resetsAt: 20,
                        status: "available",
                        usedPercent: 32,
                    },
                    weekly: { status: "unavailable" },
                },
            });
            session.events.append({
                createdAt: 2,
                data: {
                    message: {
                        blocks: [{ text: "done", type: "text" }],
                        id: "assistant-1",
                        providerId: "codex",
                        requestedModelId: created.session.modelId,
                        role: "agent",
                        usage: {
                            cacheRead: 3,
                            cacheWrite: 4,
                            cost: {
                                cacheRead: 0,
                                cacheWrite: 0,
                                input: 0,
                                output: 0,
                                total: 0,
                            },
                            input: 10,
                            output: 2,
                            totalTokens: 19,
                        },
                    },
                    runId: "run-1",
                },
                id: createEventIdFactory()(),
                sessionId: created.session.id,
                type: "agent_message",
            });

            await expect(client.getSessionUsage(created.session.id)).resolves.toMatchObject({
                context: { approximate: false, totalTokens: 19 },
                currentProviderId: "codex",
                groups: [
                    {
                        kind: "attributed",
                        modelId: created.session.modelId,
                        providerId: "codex",
                        usage: { input: 10, output: 2, totalTokens: 19 },
                    },
                ],
                observedQuota: [],
                quotas: [
                    {
                        providerId: "codex",
                        quota: {
                            windows: {
                                fiveHour: { status: "available", usedPercent: 32 },
                            },
                        },
                    },
                ],
            });
            expect(getProviderQuota).not.toHaveBeenCalledWith("codex");
        } finally {
            await close();
        }
    });

    it("applies project attachments to existing and future sessions in the same cwd only", async () => {
        const store = new InMemorySessionStore();
        store.registerSecret({
            description: "Shared project credentials",
            environment: { PROJECT_TOKEN: "project-value" },
            id: "project-service",
        });
        const { client, close } = await startServer({ store });
        try {
            const first = await client.createSession({ cwd: "/tmp/shared-secret-project" });
            const existing = await client.createSession({ cwd: "/tmp/shared-secret-project/." });
            const isolated = await client.createSession({ cwd: "/tmp/isolated-secret-project" });

            await client.attachSecret(first.session.id, "project-service", "project");

            expect(store.get(first.session.id)?.snapshot().projectSecretIds).toEqual([
                "project-service",
            ]);
            expect(store.get(existing.session.id)?.snapshot().projectSecretIds).toEqual([
                "project-service",
            ]);
            expect(store.get(isolated.session.id)?.snapshot().secretIds).toEqual([]);

            const future = await client.createSession({ cwd: "/tmp/shared-secret-project" });
            const isolatedFuture = await client.createSession({
                cwd: "/tmp/isolated-secret-project",
            });
            expect(future.session).toMatchObject({
                projectSecretIds: ["project-service"],
                secretIds: ["project-service"],
                sessionSecretIds: [],
            });
            expect(isolatedFuture.session.secretIds).toEqual([]);

            await client.detachSecret(existing.session.id, "project-service", "project");
            expect(store.get(first.session.id)?.snapshot().secretIds).toEqual([]);
            expect(store.get(existing.session.id)?.snapshot().secretIds).toEqual([]);
            expect(store.get(future.session.id)?.snapshot().secretIds).toEqual([]);
        } finally {
            await close();
        }
    });

    it("registers and lists bundle metadata without returning secret values", async () => {
        const { client, close } = await startServer();
        try {
            const registered = await client.registerSecret({
                description: "Service API credentials",
                environment: {
                    SERVICE_REGION: "never-return-region",
                    SERVICE_TOKEN: "never-return-token",
                },
                id: "service",
            });
            expect(registered.secret).toEqual({
                description: "Service API credentials",
                environmentVariables: ["SERVICE_REGION", "SERVICE_TOKEN"],
                id: "service",
            });

            const listed = await client.listSecrets();
            expect(listed.secrets).toEqual([registered.secret]);
            expect(JSON.stringify({ listed, registered })).not.toContain("never-return-region");
            expect(JSON.stringify({ listed, registered })).not.toContain("never-return-token");
        } finally {
            await close();
        }
    });

    it("does not reflect malformed secret registration values in JSON errors", async () => {
        const { close, socketPath } = await startServer();
        const secretValue = "malformed-value-must-not-return";
        try {
            const response = await requestRawJson(socketPath, "/secrets", {
                body: `{"id":"service","environment":{"TOKEN":"${secretValue}"}`,
                method: "POST",
            });

            expect(response.statusCode).toBe(400);
            expect(response.body).toContain("Request body must be valid JSON.");
            expect(response.body).not.toContain(secretValue);
        } finally {
            await close();
        }
    });

    it("removes a registration and clears both attachment sources", async () => {
        const { client, close, store } = await startServer();
        try {
            await client.registerSecret({
                description: "Disposable credentials",
                environment: { DISPOSABLE_TOKEN: "never-return-this" },
                id: "disposable",
            });
            const created = await client.createSession({ cwd: "/tmp/removable-secret-project" });
            await client.attachSecret(created.session.id, "disposable", "session");
            await client.attachSecret(created.session.id, "disposable", "project");

            await expect(client.unregisterSecret("disposable")).resolves.toEqual({
                removed: true,
            });
            expect(await client.listSecrets()).toEqual({ secrets: [] });
            expect(store.get(created.session.id)?.snapshot()).toMatchObject({
                projectSecretIds: [],
                secretIds: [],
                sessionSecretIds: [],
            });
            await expect(client.unregisterSecret("disposable")).resolves.toEqual({
                removed: false,
            });
            await expect(client.attachSecret(created.session.id, "disposable")).rejects.toThrow(
                "not registered",
            );
        } finally {
            await close();
        }
    });

    it("returns independent current quotas and observed movement for every used provider", async () => {
        const quotaFor = (providerId: string): ProviderQuota => ({
            capturedAt: 10,
            source: providerId === "codex" ? "codex" : "claude",
            windows: {
                fiveHour: {
                    capturedAt: 10,
                    resetsAt: 100,
                    status: "available",
                    usedPercent: providerId === "codex" ? 30 : 40,
                },
                weekly: {
                    capturedAt: 10,
                    resetsAt: 200,
                    status: "available",
                    usedPercent: providerId === "codex" ? 10 : 20,
                },
            },
        });
        const getProviderQuota = vi.fn(
            async (providerId: string): Promise<ProviderQuota> => quotaFor(providerId),
        );
        const { client, close, store } = await startServer({ getProviderQuota });
        try {
            const created = await client.createSession({ cwd: "/tmp/multi-provider-usage" });
            const session = store.get(created.session.id);
            if (session === undefined) throw new Error("Expected the created session.");
            const providerQuota = vi
                .spyOn(session, "providerQuota")
                .mockResolvedValue(quotaFor("codex"));
            const before = {
                capturedAt: 1,
                source: "claude" as const,
                windows: {
                    fiveHour: {
                        capturedAt: 1,
                        resetsAt: 100,
                        status: "available" as const,
                        usedPercent: 5,
                    },
                    weekly: {
                        capturedAt: 1,
                        resetsAt: 200,
                        status: "available" as const,
                        usedPercent: 2,
                    },
                },
            };
            session.events.append({
                createdAt: 2,
                data: {
                    message: {
                        blocks: [{ text: "Claude turn", type: "text" }],
                        id: "claude-message",
                        providerId: "claude",
                        requestedModelId: "anthropic/sonnet-4-6",
                        role: "agent",
                        usage: {
                            cacheRead: 0,
                            cacheWrite: 0,
                            cost: {
                                cacheRead: 0,
                                cacheWrite: 0,
                                input: 0,
                                output: 0,
                                total: 0,
                            },
                            input: 5,
                            output: 2,
                            totalTokens: 7,
                        },
                    },
                    runId: "claude-run",
                },
                id: createEventIdFactory()(),
                sessionId: created.session.id,
                type: "agent_message",
            });
            for (const [phase, quota] of [
                ["before", before],
                [
                    "after",
                    {
                        ...before,
                        capturedAt: 2,
                        windows: {
                            fiveHour: { ...before.windows.fiveHour, usedPercent: 8 },
                            weekly: { ...before.windows.weekly, usedPercent: 3 },
                        },
                    },
                ],
            ] as const) {
                session.events.append({
                    createdAt: quota.capturedAt,
                    data: {
                        observationId: "claude-observation",
                        phase,
                        providerId: "claude",
                        quota,
                        runId: "claude-run",
                    },
                    id: createEventIdFactory()(),
                    sessionId: created.session.id,
                    type: "provider_quota_observed",
                });
            }

            const response = await client.getSessionUsage(created.session.id);

            expect(response.quotas).toEqual([
                expect.objectContaining({ providerId: "claude" }),
                expect.objectContaining({ providerId: "codex" }),
            ]);
            expect(response.observedQuota).toEqual([
                {
                    providerId: "claude",
                    windows: {
                        fiveHour: { observedUsedPercent: 3 },
                        weekly: { observedUsedPercent: 1 },
                    },
                },
            ]);
            expect(getProviderQuota).toHaveBeenCalledWith("claude");
            expect(getProviderQuota).not.toHaveBeenCalledWith("codex");
            expect(providerQuota).toHaveBeenCalledOnce();
        } finally {
            await close();
        }
    });

    it("records raw user activity without appending a session event", async () => {
        const { client, close, store } = await startServer();
        try {
            const created = await client.createSession({ cwd: "/tmp/activity-project" });
            const session = store.get(created.session.id);
            if (session === undefined) throw new Error("Expected the created session.");
            const recordUserActivity = vi.spyOn(session, "recordUserActivity");
            const eventCount = session.events.since(undefined)?.length;

            await expect(client.recordSessionActivity(created.session.id)).resolves.toEqual({
                recorded: true,
            });

            expect(recordUserActivity).toHaveBeenCalledOnce();
            expect(session.events.since(undefined)).toHaveLength(eventCount ?? 0);
        } finally {
            await close();
        }
    });

    it("accepts registered initial attachments and rejects malformed secret ID lists", async () => {
        const store = new InMemorySessionStore();
        store.registerSecret({
            description: "Service API credentials",
            environment: { SERVICE_TOKEN: "secret-value" },
            id: "service",
        });
        const { client, close } = await startServer({ store });
        try {
            const created = await client.createSession({
                cwd: "/tmp/secret-project",
                secretIds: ["service"],
            });
            expect(created.session.secretIds).toEqual(["service"]);

            await expect(
                client.createSession({
                    cwd: "/tmp/malformed-secret-project",
                    secretIds: "service" as unknown as readonly string[],
                }),
            ).rejects.toThrow("Secret IDs must be provided as a list of text IDs.");
            await expect(
                client.createSession({
                    cwd: "/tmp/unknown-secret-project",
                    secretIds: ["missing"],
                }),
            ).rejects.toThrow("not registered");
            expect(store.list()).toHaveLength(1);
        } finally {
            await close();
        }
    });

    it("uses Docker defaults unless the new session chooses another environment", async () => {
        const defaultDocker: DockerExecutionConfig = {
            image: "default:local",
            mounts: [{ source: ".", target: "/workspace" }],
            workingDirectory: "/workspace",
        };
        const { client, close, store } = await startServer({ defaultDocker });
        try {
            const configured = await client.createSession({ cwd: "/tmp/default-project" });
            const explicit = await client.createSession({
                cwd: "/tmp/explicit-project",
                docker: { container: "already-running", workingDirectory: "/repo" },
            });
            const local = await client.createSession({
                cwd: "/tmp/local-project",
                local: true,
            });

            expect(store.get(configured.session.id)?.requestForSubagent().docker).toEqual({
                image: "default:local",
                mounts: [{ source: "/tmp/default-project", target: "/workspace" }],
                name: `rig-${configured.session.id}`,
                workingDirectory: "/workspace",
            });
            expect(store.get(explicit.session.id)?.requestForSubagent().docker).toEqual({
                container: "already-running",
                workingDirectory: "/repo",
            });
            expect(store.get(local.session.id)?.requestForSubagent().docker).toBeUndefined();
        } finally {
            await close();
        }
    });

    it("rejects malformed Docker session settings before creating a session", async () => {
        const { client, close, socketPath } = await startServer();
        try {
            await expect(
                client.createSession({
                    cwd: "/tmp/invalid-docker-project",
                    docker: {
                        image: "project:local",
                        workingDirectory: "relative/path",
                    },
                }),
            ).rejects.toThrow("absolute container path");
            const malformed = await requestRawJson(socketPath, "/sessions", {
                body: JSON.stringify({
                    cwd: "/tmp/invalid-docker-project",
                    docker: { image: "project:local", workingDirectory: "relative/path" },
                }),
                method: "POST",
            });
            const conflicting = await requestRawJson(socketPath, "/sessions", {
                body: JSON.stringify({
                    cwd: "/tmp/invalid-docker-project",
                    docker: { image: "project:local", workingDirectory: "/workspace" },
                    local: true,
                }),
                method: "POST",
            });
            expect(malformed.statusCode).toBe(400);
            expect(conflicting.statusCode).toBe(400);
        } finally {
            await close();
        }
    });

    it("does not expose global events when the durable queue is disabled", async () => {
        const { client, close } = await startServer();
        try {
            await expect(client.getDaemonConfig()).resolves.toEqual({
                config: { settings: { durableGlobalEventQueue: false } },
            });
            await expect(client.getGlobalEvents()).rejects.toThrow(
                "The durable global event queue is disabled.",
            );
            await expect(client.health()).resolves.toMatchObject({
                durableGlobalEventQueue: false,
            });
        } finally {
            await close();
        }
    });

    it("starts the daemon inspector through the authenticated local protocol", async () => {
        const onStartInspector = vi.fn(async () => ({
            inspectorUrl: "ws://127.0.0.1:42002/daemon",
        }));
        const { client, close } = await startServer({ onStartInspector });
        try {
            await expect(client.startInspector()).resolves.toEqual({
                inspectorUrl: "ws://127.0.0.1:42002/daemon",
            });
            expect(onStartInspector).toHaveBeenCalledOnce();
        } finally {
            await close();
        }
    });

    it("hot-reloads Happy credentials through the authenticated local protocol", async () => {
        const onReloadHappy = vi.fn(async () => true);
        const { client, close } = await startServer({ onReloadHappy });
        try {
            await expect(client.reloadHappy()).resolves.toEqual({ enabled: true });
            expect(onReloadHappy).toHaveBeenCalledOnce();
        } finally {
            await close();
        }
    });

    it("enables and disables the durable queue through daemon configuration", async () => {
        const store = new PersistentSessionStore({ databasePath: ":memory:" });
        const { client, close } = await startServer({
            onDurableGlobalEventQueueChange: (enabled) => store.setDurableGlobalEventQueue(enabled),
            store,
        });
        try {
            await expect(
                client.updateDaemonConfig({
                    settings: { durableGlobalEventQueue: true },
                }),
            ).resolves.toEqual({
                config: { settings: { durableGlobalEventQueue: true } },
            });
            let resolveObserved: (() => void) | undefined;
            const observed = new Promise<void>((resolve) => {
                resolveObserved = resolve;
            });
            const watching = client.watchGlobalEvents({
                onEvent: () => resolveObserved?.(),
            });
            const stoppedWatching = expect(watching).rejects.toThrow("SSE failed with HTTP 404");
            const created = await client.createSession({ cwd: "/tmp/rig-socket-config" });
            await observed;
            const queued = await client.getGlobalEvents();
            expect(queued.events).toEqual([
                expect.objectContaining({
                    event: expect.objectContaining({
                        sessionId: created.session.id,
                        type: "session_created",
                    }),
                }),
            ]);

            await client.updateDaemonConfig({
                settings: { durableGlobalEventQueue: false },
            });
            await stoppedWatching;
            await expect(client.getGlobalEvents()).rejects.toThrow(
                "The durable global event queue is disabled.",
            );
            await expect(client.getDaemonConfig()).resolves.toEqual({
                config: { settings: { durableGlobalEventQueue: false } },
            });

            await client.updateDaemonConfig({
                settings: { durableGlobalEventQueue: true },
            });
            await expect(client.getGlobalEvents()).resolves.toEqual(queued);
        } finally {
            await close();
            store.close();
        }
    });

    it("streams and trims durable events across every session", async () => {
        const store = new PersistentSessionStore({
            databasePath: ":memory:",
            durableGlobalEventQueue: true,
        });
        const globalEventQueue = store.globalEventQueue;
        if (globalEventQueue === undefined) throw new Error("Expected the global event queue.");
        const { client, close } = await startServer({
            globalEventQueue,
            store,
        });
        try {
            const first = await client.createSession({ cwd: "/tmp/rig-global-events-a" });
            const second = await client.createSession({ cwd: "/tmp/rig-global-events-b" });
            const queued = await client.getGlobalEvents();

            expect(queued.events.map((entry) => entry.event.sessionId)).toEqual([
                first.session.id,
                second.session.id,
            ]);
            const firstCursor = queued.events[0]?.cursor;
            const secondCursor = queued.events[1]?.cursor;
            if (firstCursor === undefined || secondCursor === undefined) {
                throw new Error("Expected global event cursors.");
            }

            const controller = new AbortController();
            const streamed = new Promise<SessionEvent>((resolve) => {
                void client.watchGlobalEvents({
                    after: secondCursor,
                    onEvent: (entry) => {
                        controller.abort();
                        resolve(entry.event);
                    },
                    signal: controller.signal,
                });
            });
            await client.changeEffort(first.session.id, { effort: "high" });
            await expect(streamed).resolves.toMatchObject({
                sessionId: first.session.id,
                type: "effort_changed",
            });

            await expect(client.trimGlobalEvents(firstCursor)).resolves.toEqual({
                trimmed: 1,
                through: firstCursor,
            });
            await expect(client.getGlobalEvents(0)).rejects.toThrow(
                "The global event cursor is not available.",
            );
            const remaining = await client.getGlobalEvents(firstCursor);
            expect(remaining.events[0]?.event.sessionId).toBe(second.session.id);
            await expect(client.getEvents(first.session.id)).resolves.toMatchObject({
                events: expect.arrayContaining([
                    expect.objectContaining({ type: "session_created" }),
                ]),
            });
            await expect(client.health()).resolves.toMatchObject({
                durableGlobalEventQueue: true,
            });
        } finally {
            await close();
            store.close();
        }
    });

    it("rejects a transcript limit while catching up from an event cursor", async () => {
        const { client, close, socketPath } = await startServer();
        try {
            const created = await client.createSession({ cwd: "/tmp/rig-limited-event-catchup" });
            const response = await requestRawJson(
                socketPath,
                `/sessions/${encodeURIComponent(created.session.id)}/events?after=event-1&message_limit=30`,
                { body: "", method: "GET" },
            );

            expect(response.statusCode).toBe(400);
            expect(response.body).toContain("only supported while loading initial history");
        } finally {
            await close();
        }
    });

    it("requires bearer auth", async () => {
        const { close, socketPath } = await startServer();
        try {
            const client = new ProtocolHttpClient({ socketPath, token: "wrong" });
            await expect(client.health()).rejects.toThrow("Unauthorized");
        } finally {
            await close();
        }
    });

    it("serves daemon readiness and model catalog", async () => {
        const { client, close } = await startServer();
        try {
            const health = await client.health();
            const models = await client.models();

            expect(health).toMatchObject({
                healthy: true,
                identity: { version: expect.any(String) },
                ready: true,
                status: "ready",
            });
            if (health.status !== "ready") throw new Error("Expected the daemon to be ready.");
            expect(health.catalog.models.map((model) => model.id)).toContain(
                modelOpenaiGpt56Sol.id,
            );
            expect(models.catalog.models.map((model) => model.id)).toContain(
                modelOpenaiGpt56Sol.id,
            );
        } finally {
            await close();
        }
    });

    it("changes session effort through a dedicated endpoint", async () => {
        const { client, close } = await startServer();
        try {
            const created = await client.createSession({
                cwd: "/tmp/rig-protocol-test",
                modelId: modelOpenaiGpt56Sol.id,
            });

            const changed = await client.changeEffort(created.session.id, { effort: "high" });
            const events = await client.getEvents(created.session.id, created.session.lastEventId);

            expect(changed.session.effort).toBe("high");
            expect(events.events.at(-1)).toMatchObject({
                data: {
                    effort: "high",
                    modelId: modelOpenaiGpt56Sol.id,
                },
                type: "effort_changed",
            });
        } finally {
            await close();
        }
    });

    it("creates, updates, and clears an appended system prompt", async () => {
        const { client, close } = await startServer();
        try {
            const created = await client.createSession({
                appendSystemPrompt: "Created API instructions.",
                cwd: "/tmp/rig-protocol-test",
            });

            expect(created.session.appendSystemPrompt).toBe("Created API instructions.");
            expect(created.session.snapshot.appendSystemPrompt).toBe("Created API instructions.");

            await expect(
                client.createSession({
                    appendSystemPrompt: 42 as unknown as string,
                    cwd: "/tmp/rig-invalid-prompt-test",
                }),
            ).rejects.toThrow("The appended system prompt must be text.");

            const updated = await client.updateSession(created.session.id, {
                appendSystemPrompt: "Updated API instructions.",
            });
            const events = await client.getEvents(created.session.id, created.session.lastEventId);

            expect(updated.session.appendSystemPrompt).toBe("Updated API instructions.");
            expect(updated.session.snapshot.appendSystemPrompt).toBe("Updated API instructions.");
            expect(events.events.at(-1)).toMatchObject({
                data: {
                    session: { appendSystemPrompt: "Updated API instructions." },
                },
                type: "session_updated",
            });

            const cleared = await client.updateSession(created.session.id, {
                appendSystemPrompt: null,
            });
            expect(cleared.session.appendSystemPrompt).toBeUndefined();
            expect(cleared.session.snapshot.appendSystemPrompt).toBeUndefined();

            await expect(
                client.updateSession(created.session.id, {
                    appendSystemPrompt: 42 as unknown as string,
                }),
            ).rejects.toThrow("The appended system prompt must be text or null.");
        } finally {
            await close();
        }
    });

    it("changes the service tier through a dedicated endpoint", async () => {
        const { client, close } = await startServer();
        try {
            const created = await client.createSession({
                cwd: "/tmp/rig-protocol-test",
                modelId: modelOpenaiGpt55.id,
            });

            const changed = await client.changeServiceTier(created.session.id, {
                serviceTier: "fast",
            });
            const events = await client.getEvents(created.session.id, created.session.lastEventId);

            expect(changed.session.serviceTier).toBe("fast");
            expect(changed.session.snapshot.serviceTier).toBe("fast");
            expect(events.events.at(-1)).toMatchObject({
                data: { serviceTier: "fast" },
                type: "service_tier_changed",
            });
        } finally {
            await close();
        }
    });

    it("changes session permissions through a dedicated endpoint", async () => {
        const { client, close } = await startServer();
        try {
            const created = await client.createSession({ cwd: "/tmp/rig-protocol-test" });

            const changed = await client.changePermissionMode(created.session.id, {
                permissionMode: "auto",
            });
            const events = await client.getEvents(created.session.id, created.session.lastEventId);

            expect(changed.session.permissionMode).toBe("auto");
            expect(events.events.at(-1)).toMatchObject({
                data: { permissionMode: "auto" },
                type: "permission_mode_changed",
            });
        } finally {
            await close();
        }
    });

    it("stops a running workflow through the protocol", async () => {
        const { client, close, store } = await startServer();
        try {
            const created = await client.createSession({ cwd: "/tmp/rig-protocol-test" });
            const session = store.get(created.session.id);
            expect(session).toBeDefined();
            const run = session?.launchWorkflow({
                code: "42",
                description: "Wait until stopped",
                execute: ({ signal }) =>
                    new Promise<never>((_resolve, reject) => {
                        signal.addEventListener(
                            "abort",
                            () => reject(new Error("Cancelled by the monitor.")),
                            { once: true },
                        );
                    }),
                name: "monitor-stop",
            });
            expect(run).toBeDefined();
            if (run === undefined) throw new Error("Expected a workflow run.");

            await expect(client.stopWorkflow(created.session.id, run.runId)).resolves.toEqual({
                workflow: expect.objectContaining({
                    error: "The workflow was stopped.",
                    runId: run.runId,
                    status: "stopped",
                }),
            });
            session?.abort();
        } finally {
            await close();
        }
    });

    it("stops background terminals through a dedicated endpoint", async () => {
        const { client, close, store } = await startServer();
        try {
            const created = await client.createSession({ cwd: "/tmp/rig-protocol-test" });
            const session = store.get(created.session.id);
            expect(session).toBeDefined();
            const stopBackgroundProcesses = vi
                .spyOn(session!, "stopBackgroundProcesses")
                .mockResolvedValueOnce(2);

            await expect(client.stopBackgroundProcesses(created.session.id)).resolves.toEqual({
                stoppedProcesses: 2,
            });
            expect(stopBackgroundProcesses).toHaveBeenCalledOnce();
            await expect(client.health()).resolves.toMatchObject({ healthy: true });
        } finally {
            await close();
        }
    });

    it("rejects steering when the session has no active run", async () => {
        const { client, close } = await startServer();
        try {
            const created = await client.createSession({ cwd: "/tmp/rig-protocol-test" });

            await expect(
                client.steerMessage(created.session.id, { text: "Change direction." }),
            ).rejects.toThrow("There is no active run to steer.");
        } finally {
            await close();
        }
    });

    it("rejects message and steering requests without text", async () => {
        const { client, close, socketPath, store } = await startServer();
        try {
            const created = await client.createSession({ cwd: "/tmp/rig-protocol-test" });
            const session = store.get(created.session.id);
            if (session === undefined) throw new Error("Expected the created session.");
            const submit = vi.spyOn(session, "submit");
            const steer = vi.spyOn(session, "steer");

            for (const route of ["messages", "steer"]) {
                const response = await requestRawJson(
                    socketPath,
                    `/sessions/${created.session.id}/${route}`,
                    { body: "{}", method: "POST" },
                );

                expect(response.statusCode).toBe(400);
                expect(response.body).toContain("Message text must be text.");
            }
            expect(submit).not.toHaveBeenCalled();
            expect(steer).not.toHaveBeenCalled();
        } finally {
            await close();
        }
    });

    it("rejects non-object shell command requests", async () => {
        const { client, close, socketPath } = await startServer();
        try {
            const created = await client.createSession({ cwd: "/tmp/rig-protocol-test" });
            const response = await requestRawJson(
                socketPath,
                `/sessions/${created.session.id}/shell`,
                { body: "null", method: "POST" },
            );

            expect(response.statusCode).toBe(400);
            expect(response.body).toContain("Enter a shell command after !.");
        } finally {
            await close();
        }
    });

    it("reads and stops one direct shell process through its stable session id", async () => {
        const { client, close } = await startServer();
        try {
            const created = await client.createSession({
                cwd: "/tmp/rig-protocol-test",
                permissionMode: "full_access",
            });
            const started = await client.runShellCommand(created.session.id, {
                command: "sleep 60",
                commandId: "shell-command-1",
            });

            expect(started).toMatchObject({
                command: "sleep 60",
                commandId: "shell-command-1",
                status: "running",
            });
            if (started.status !== "running") throw new Error("Expected a running command.");

            await expect(
                client.readBackgroundProcess(created.session.id, started.sessionId),
            ).resolves.toMatchObject({
                command: "sleep 60",
                sessionId: started.sessionId,
            });
            await expect(
                client.readBackgroundProcess(created.session.id, 999_999),
            ).resolves.toBeUndefined();
            await expect(
                client.stopBackgroundProcess(created.session.id, started.sessionId),
            ).resolves.toMatchObject({
                process: { sessionId: started.sessionId },
                stopped: true,
            });
            await expect(
                client.readBackgroundProcess(created.session.id, started.sessionId),
            ).resolves.toMatchObject({ sessionId: started.sessionId });
        } finally {
            await close();
        }
    });

    it("reports abort failures without dropping the protocol connection", async () => {
        const { client, close, store } = await startServer();
        try {
            const created = await client.createSession({ cwd: "/tmp/rig-protocol-test" });
            const session = store.get(created.session.id);
            expect(session).toBeDefined();
            vi.spyOn(session!, "abort").mockRejectedValueOnce(
                new Error("The background process could not be stopped."),
            );

            await expect(client.abort(created.session.id)).rejects.toThrow(
                "The background process could not be stopped.",
            );
            await expect(client.health()).resolves.toMatchObject({ healthy: true });
        } finally {
            await close();
        }
    });

    it("updates and clears a persisted goal through dedicated endpoints", async () => {
        const store = new PersistentSessionStore({ databasePath: ":memory:" });
        store.saveSession(pausedGoalState());
        const { client, close } = await startServer({ store });
        try {
            const changed = await client.changeGoalStatus("goal-session", { status: "blocked" });
            expect(changed.session.goal).toMatchObject({
                objective: "Finish the protocol",
                status: "blocked",
            });

            const cleared = await client.clearGoal("goal-session");
            expect(cleared.session.goal).toBeUndefined();
        } finally {
            await close();
            store.close();
        }
    });

    it("answers a pending structured question through the protocol", async () => {
        const { client, close, store } = await startServer();
        try {
            const created = await client.createSession({ cwd: "/tmp/rig-protocol-test" });
            const session = store.get(created.session.id);
            expect(session).toBeDefined();
            const pending = session?.requestUserInput({
                requestId: "question/1",
                questions: [
                    {
                        header: "Database",
                        id: "database",
                        multiSelect: false,
                        options: [
                            { label: "PostgreSQL", description: "Use a server database." },
                            { label: "SQLite", description: "Use a local database." },
                        ],
                        question: "Which database should be used?",
                    },
                ],
            });

            await expect(
                client.answerUserInput(created.session.id, "question/1", {
                    answers: {},
                }),
            ).rejects.toThrow("Answer the Database question");

            const answered = await client.answerUserInput(created.session.id, "question/1", {
                answers: { database: ["SQLite"] },
            });

            await expect(pending).resolves.toEqual({ answers: { database: ["SQLite"] } });
            expect(answered.session.pendingUserInputs).toEqual([]);
            await expect(
                client.answerUserInput(created.session.id, "question/1", {
                    answers: { database: ["PostgreSQL"] },
                }),
            ).rejects.toThrow("no longer waiting");

            const optional = session?.requestUserInput({
                requestId: "question/optional",
                questions: [
                    {
                        header: "Nickname",
                        id: "nickname",
                        multiSelect: false,
                        options: [],
                        question: "Choose an optional nickname.",
                        required: false,
                    },
                ],
            });
            await client.answerUserInput(created.session.id, "question/optional", { answers: {} });
            await expect(optional).resolves.toEqual({ answers: {} });
        } finally {
            await close();
        }
    });

    it("rejects unknown permission modes", async () => {
        const { client, close } = await startServer();
        try {
            const created = await client.createSession({ cwd: "/tmp/rig-protocol-test" });

            await expect(
                client.changePermissionMode(created.session.id, {
                    permissionMode: "unrestricted" as "full_access",
                }),
            ).rejects.toThrow(
                "Permission mode must be one of: auto, workspace_write, read_only, or full_access.",
            );
        } finally {
            await close();
        }
    });

    it("compacts sessions through a dedicated endpoint", async () => {
        const { client, close } = await startServer();
        try {
            const created = await client.createSession({ cwd: "/tmp/rig-protocol-test" });

            const compacted = await client.compact(created.session.id);

            expect(compacted.result.compacted).toBe(false);
            expect(compacted.session.id).toBe(created.session.id);
            expect(compacted.session.snapshot.messages).toEqual([]);
        } finally {
            await close();
        }
    });

    it("serves catch-up events since a cursor", async () => {
        const { client, close, store } = await startServer();
        try {
            const created = await client.createSession({ cwd: "/tmp/rig-protocol-test" });
            const session = store.get(created.session.id);
            expect(session).toBeDefined();
            const createEventId = createEventIdFactory({ now: () => 1_700_000_000_000 });
            const first = sessionResetEvent(created.session.id, createEventId());
            const second = sessionResetEvent(created.session.id, createEventId());
            session?.events.append(first);
            session?.events.append(second);

            const received = await client.getEvents(created.session.id, first.id);

            expect(received.events.map((event) => event.id)).toEqual([second.id]);
        } finally {
            await close();
        }
    });

    it("rejects REST and SSE cursors owned by another session", async () => {
        const { client, close } = await startServer();
        try {
            const first = await client.createSession({ cwd: "/tmp/rig-protocol-first" });
            const second = await client.createSession({ cwd: "/tmp/rig-protocol-second" });
            const otherSessionCursor = second.session.lastEventId;
            if (otherSessionCursor === undefined) throw new Error("Expected a session cursor.");

            await expect(client.getEvents(first.session.id, otherSessionCursor)).rejects.toThrow(
                "Event cursor not found",
            );
            await expect(
                client.watchSessionEvents({
                    after: otherSessionCursor,
                    sessionId: first.session.id,
                    onEvent() {},
                }),
            ).rejects.toThrow("409");
        } finally {
            await close();
        }
    });

    it("omits transient agent deltas from initial history but preserves cursor catch-up", async () => {
        const { client, close, store } = await startServer();
        try {
            const created = await client.createSession({ cwd: "/tmp/rig-protocol-test" });
            const session = store.get(created.session.id);
            expect(session).toBeDefined();
            const createEventId = createEventIdFactory({ now: () => 1_700_000_000_000 });
            const cursor = sessionResetEvent(created.session.id, createEventId());
            const transient: SessionEvent = {
                createdAt: 1_700_000_000_001,
                data: {
                    event: {
                        contentIndex: 0,
                        delta: "live",
                        partial: {},
                        type: "text_delta",
                    },
                    runId: "run-1",
                },
                id: createEventId(),
                sessionId: created.session.id,
                type: "agent_event",
            } as SessionEvent;
            const compaction: SessionEvent = {
                createdAt: 1_700_000_000_002,
                data: {
                    event: {
                        compactedMessageCount: 8,
                        estimatedTokensAfter: 600,
                        estimatedTokensBefore: 4_200,
                        reason: "threshold",
                        type: "context_compacted",
                    },
                    runId: "run-1",
                },
                id: createEventId(),
                sessionId: created.session.id,
                type: "agent_event",
            };
            const backgroundProcesses: SessionEvent = {
                createdAt: 1_700_000_000_003,
                data: {
                    event: { running: 1, type: "background_processes_changed" },
                    runId: "run-1",
                },
                id: createEventId(),
                sessionId: created.session.id,
                type: "agent_event",
            };
            const durable = sessionResetEvent(created.session.id, createEventId());
            session?.events.append(cursor);
            session?.events.append(transient);
            session?.events.append(compaction);
            session?.events.append(backgroundProcesses);
            session?.events.append(durable);

            const initial = await client.getEvents(created.session.id);
            const catchup = await client.getEvents(created.session.id, cursor.id);

            expect(initial.events.map((event) => event.id)).not.toContain(transient.id);
            expect(initial.events.map((event) => event.id)).toContain(compaction.id);
            expect(initial.events.map((event) => event.id)).toContain(backgroundProcesses.id);
            expect(initial.events.map((event) => event.id)).toContain(durable.id);
            expect(catchup.events.map((event) => event.id)).toEqual([
                compaction.id,
                backgroundProcesses.id,
                durable.id,
            ]);
        } finally {
            await close();
        }
    });

    it("recovers REST and SSE catch-up from a live-only cursor after restart", async () => {
        const databaseDirectory = await mkdtemp(join(tmpdir(), "rig-protocol-cursor-test-"));
        const databasePath = join(databaseDirectory, "sessions.sqlite");
        let originalStore: PersistentSessionStore | undefined;
        let restoredStore: PersistentSessionStore | undefined;
        let server: Awaited<ReturnType<typeof startServer>> | undefined;
        try {
            originalStore = new PersistentSessionStore({ databasePath });
            const session = originalStore.create({ cwd: "/tmp/rig-protocol-test" });
            const createFutureEventId = createEventIdFactory({ now: () => Date.now() + 60_000 });
            const transient: SessionEvent = {
                createdAt: Date.now(),
                data: {
                    event: { contentIndex: 0, delta: "live", partial: {}, type: "text_delta" },
                    runId: "run-1",
                },
                id: createFutureEventId(),
                sessionId: session.id,
                type: "agent_event",
            } as SessionEvent;
            session.events.append(transient);
            originalStore.close();
            originalStore = undefined;

            restoredStore = new PersistentSessionStore({ databasePath });
            const restored = restoredStore.get(session.id);
            await restored?.changePermissionMode({ permissionMode: "read_only" });
            const durable = restored?.events.since(transient.id) ?? [];
            expect(durable.map((event) => event.type)).toContain("permission_mode_changed");
            expect(durable.every((event) => event.id > transient.id)).toBe(true);

            server = await startServer({ store: restoredStore });
            await expect(server.client.getEvents(session.id, transient.id)).resolves.toEqual({
                events: durable,
            });

            const controller = new AbortController();
            const streamed: SessionEvent[] = [];
            await server.client.watchSessionEvents({
                after: transient.id,
                sessionId: session.id,
                signal: controller.signal,
                onEvent(event) {
                    streamed.push(event);
                    if (streamed.length === durable.length) controller.abort();
                },
            });
            expect(streamed).toEqual(durable);
        } finally {
            await server?.close();
            restoredStore?.close();
            originalStore?.close();
            await rm(databaseDirectory, { recursive: true, force: true });
        }
    });

    it("serves session summaries", async () => {
        const { client, close } = await startServer();
        try {
            await client.createSession({ cwd: "/tmp/rig-protocol-test-a" });
            await client.createSession({ cwd: "/tmp/rig-protocol-test-b" });

            const response = await client.listSessions(1);

            expect(response.sessions).toHaveLength(1);
            expect(response.sessions[0]).toMatchObject({
                status: "idle",
                titleStatus: "idle",
            });
        } finally {
            await close();
        }
    });

    it("forks a completed session into a new resumable session", async () => {
        const { client, close } = await startServer();
        try {
            const created = await client.createSession({ cwd: "/tmp/rig-protocol-test" });
            const forked = await client.forkSession(created.session.id);

            expect(forked.session.id).not.toBe(created.session.id);
            expect(forked.session.agent).toMatchObject({
                depth: 0,
                rootSessionId: forked.session.id,
                type: "primary",
            });
            expect(forked.session.cwd).toBe(created.session.cwd);
            expect(forked.session.modelLocked).toBe(false);
        } finally {
            await close();
        }
    });

    it("searches files in the session workspace through the daemon", async () => {
        const search = vi.fn(async () => [
            { fileName: "CodingAssistantApp.ts", path: "sources/app/CodingAssistantApp.ts" },
        ]);
        const fileSearchService: FileSearchServiceContract = {
            close: vi.fn(),
            search,
        };
        const { client, close } = await startServer({ fileSearchService });
        try {
            const created = await client.createSession({ cwd: "/tmp/rig-protocol-test" });

            const response = await client.searchFiles(created.session.id, "coding app", 7);

            expect(search).toHaveBeenCalledWith("/tmp/rig-protocol-test", "coding app", 7);
            expect(response.files).toEqual([
                {
                    fileName: "CodingAssistantApp.ts",
                    path: "sources/app/CodingAssistantApp.ts",
                },
            ]);
        } finally {
            await close();
        }
    });

    it("accepts image content blocks on submitted messages", async () => {
        const { client, close } = await startServer();
        try {
            const created = await client.createSession({ cwd: "/tmp/rig-protocol-test" });

            await client.submitMessage(created.session.id, {
                content: [
                    { type: "text", text: "inspect this " },
                    { type: "image", mediaType: "image/png", data: "aW1hZ2U=" },
                ],
                displayText: "inspect this [Image #1 PNG]",
                text: "inspect this [Image #1 PNG]",
            });
            const events = await client.getEvents(created.session.id, created.session.lastEventId);
            const submitted = events.events.find((event) => event.type === "message_submitted");

            expect(submitted).toMatchObject({
                data: {
                    displayText: "inspect this [Image #1 PNG]",
                    message: {
                        blocks: [
                            { type: "text", text: "inspect this " },
                            { type: "image", mediaType: "image/png", data: "aW1hZ2U=" },
                        ],
                        role: "user",
                    },
                },
                type: "message_submitted",
            });
        } finally {
            await close();
        }
    });

    it("accepts shutdown requests", async () => {
        let shutdownRequested = false;
        const { client, close } = await startServer({
            onShutdown: () => {
                shutdownRequested = true;
            },
        });
        try {
            await expect(client.shutdown()).resolves.toEqual({
                pid: process.pid,
                shuttingDown: true,
            });
            await new Promise((resolve) => setImmediate(resolve));

            expect(shutdownRequested).toBe(true);
        } finally {
            await close();
        }
    });

    it("rejects new mutations as soon as shutdown begins", async () => {
        const taskDrain = new TrackedTaskDrain();
        const { client, close } = await startServer({ taskDrain });
        try {
            const created = await client.createSession({ cwd: "/tmp/rig-closing-test" });

            await expect(client.shutdown()).resolves.toEqual({
                pid: process.pid,
                shuttingDown: true,
            });
            await expect(
                client.submitMessage(created.session.id, { text: "Too late" }),
            ).rejects.toThrow("local daemon is shutting down");
            await expect(client.getSession(created.session.id)).resolves.toMatchObject({
                session: { id: created.session.id },
            });
        } finally {
            await close();
        }
    });

    it("rewinds a session to a selected user message", async () => {
        const store = new PersistentSessionStore({ databasePath: ":memory:" });
        const state = pausedGoalState();
        const first = {
            blocks: [{ text: "Keep this", type: "text" as const }],
            id: "message-1",
            role: "user" as const,
        };
        const second = {
            blocks: [{ text: "Try this again", type: "text" as const }],
            id: "message-2",
            role: "user" as const,
        };
        store.saveSession({ ...state, contextMessages: [first, second] });
        store.upsertMessage(state.id, {
            isPartial: false,
            message: first,
            position: 0,
            runId: "run-1",
        });
        store.upsertMessage(state.id, {
            isPartial: false,
            message: second,
            position: 1,
            runId: "run-2",
        });
        const { client, close } = await startServer({ store });
        try {
            const response = await client.rewind(state.id, second.id);

            expect(response.message).toEqual(second);
            expect(response.session.snapshot.messages).toEqual([first]);
        } finally {
            await close();
            store.close();
        }
    });

    it("serves subagent history but rejects attempts to resume it", async () => {
        const store = new PersistentSessionStore({ databasePath: ":memory:" });
        store.saveSession(readOnlySubagentState());
        const { client, close } = await startServer({ store });
        try {
            const loaded = await client.getSession("subagent-1");

            expect(loaded.session.agent).toMatchObject({
                parentSessionId: "session-1",
                type: "subagent",
            });
            await expect(
                client.submitMessage("subagent-1", { text: "Continue working." }),
            ).rejects.toThrow("read-only");
            await expect(client.reset("subagent-1")).rejects.toThrow("read-only");
            await expect(client.rewind("subagent-1", "message-1")).rejects.toThrow("read-only");
            await expect(client.compact("subagent-1")).rejects.toThrow("read-only");
            await expect(
                client.broadcastMessage({
                    sessionIds: ["subagent-1"],
                    text: "Continue working.",
                }),
            ).rejects.toThrow("cannot receive broadcasts");
        } finally {
            await close();
            store.close();
        }
    });
});

async function startServer(
    options: {
        defaultDocker?: DockerExecutionConfig;
        fileSearchService?: FileSearchServiceContract;
        globalEventQueue?: GlobalEventQueue;
        getProviderQuota?: (providerId: string) => Promise<ProviderQuota | undefined>;
        onDurableGlobalEventQueueChange?: (
            enabled: boolean,
        ) => GlobalEventQueue | undefined | Promise<GlobalEventQueue | undefined>;
        onShutdown?: () => void;
        onReloadHappy?: () => boolean | Promise<boolean>;
        onStartInspector?: () => Promise<{ inspectorUrl: string }>;
        store?: SessionStore;
        taskDrain?: TrackedTaskDrain;
    } = {},
): Promise<{
    client: ProtocolHttpClient;
    close: () => Promise<void>;
    socketPath: string;
    store: SessionStore;
}> {
    const directory = await mkdtemp(join(tmpdir(), "rig-server-test-"));
    const socketPath = join(directory, "server.sock");
    const store = options.store ?? new InMemorySessionStore();
    const server = createProtocolHttpServer({
        ...(options.defaultDocker === undefined ? {} : { defaultDocker: options.defaultDocker }),
        ...(options.fileSearchService !== undefined
            ? { fileSearchService: options.fileSearchService }
            : {}),
        ...(options.globalEventQueue === undefined
            ? {}
            : { globalEventQueue: options.globalEventQueue }),
        ...(options.getProviderQuota === undefined
            ? {}
            : { getProviderQuota: options.getProviderQuota }),
        ...(options.onShutdown !== undefined ? { onShutdown: options.onShutdown } : {}),
        ...(options.onReloadHappy !== undefined ? { onReloadHappy: options.onReloadHappy } : {}),
        ...(options.onStartInspector !== undefined
            ? { onStartInspector: options.onStartInspector }
            : {}),
        ...(options.onDurableGlobalEventQueueChange === undefined
            ? {}
            : {
                  onDurableGlobalEventQueueChange: options.onDurableGlobalEventQueueChange,
              }),
        store,
        ...(options.taskDrain === undefined ? {} : { taskDrain: options.taskDrain }),
        token: "secret",
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, () => {
            server.off("error", reject);
            resolve();
        });
    });

    return {
        client: new ProtocolHttpClient({ socketPath, token: "secret" }),
        socketPath,
        store,
        async close() {
            await new Promise<void>((resolve) => server.close(() => resolve()));
            await rm(directory, { recursive: true, force: true });
        },
    };
}

async function requestRawJson(
    socketPath: string,
    path: string,
    options: { body: string; method: string },
): Promise<{ body: string; statusCode: number | undefined }> {
    return new Promise((resolve, reject) => {
        const request = httpRequest(
            {
                headers: {
                    authorization: "Bearer secret",
                    "content-type": "application/json",
                },
                method: options.method,
                path,
                socketPath,
            },
            (response) => {
                const chunks: Buffer[] = [];
                response.on("data", (chunk: Buffer) => chunks.push(chunk));
                response.on("end", () => {
                    resolve({
                        body: Buffer.concat(chunks).toString("utf8"),
                        statusCode: response.statusCode,
                    });
                });
            },
        );
        request.once("error", reject);
        request.end(options.body);
    });
}

function readOnlySubagentState(): PersistedSessionState {
    return {
        agent: {
            depth: 1,
            description: "Inspect the protocol",
            parentSessionId: "session-1",
            rootSessionId: "session-1",
            type: "subagent",
        },
        agentId: "agent-2",
        cwd: "/tmp/rig-protocol-test",
        id: "subagent-1",
        messages: [],
        modelId: modelOpenaiGpt55.id,
        models: [],
        providerId: "codex",
        permissionMode: "workspace_write",
        queuedRuns: [],
        nextTaskId: 1,
        status: "completed",
        tasks: [],
        title: "Inspect the protocol",
        titleStatus: "ready",
        tools: [],
    };
}

function pausedGoalState(): PersistedSessionState {
    return {
        agent: { depth: 0, rootSessionId: "goal-session", type: "primary" },
        agentId: "goal-agent",
        cwd: "/tmp/rig-protocol-test",
        goal: {
            createdAt: 1,
            objective: "Finish the protocol",
            status: "paused",
            updatedAt: 1,
        },
        id: "goal-session",
        messages: [],
        modelId: modelOpenaiGpt55.id,
        models: [],
        nextTaskId: 1,
        permissionMode: "workspace_write",
        providerId: "codex",
        queuedRuns: [],
        status: "idle",
        tasks: [],
        titleStatus: "idle",
        tools: [],
    };
}

function sessionResetEvent(sessionId: string, id: string): SessionEvent {
    return {
        createdAt: 1_700_000_000_000,
        data: {
            snapshot: {
                id: "agent-1",
                messages: [],
                modelId: "openai/gpt-5.5",
                providerId: "codex",
                queue: [],
                status: "idle",
                tools: [],
            },
        },
        id,
        sessionId,
        type: "session_reset",
    };
}
