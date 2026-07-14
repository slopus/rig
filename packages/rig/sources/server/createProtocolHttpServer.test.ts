import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import { ProtocolHttpClient } from "../client/ProtocolHttpClient.js";
import { createEventIdFactory, type SessionEvent } from "../protocol/index.js";
import { modelOpenaiGpt55, modelOpenaiGpt56Sol } from "../providers/models.js";
import { InMemorySessionStore } from "./InMemorySessionStore.js";
import type { PersistedSessionState } from "./InMemorySession.js";
import { PersistentSessionStore } from "./PersistentSessionStore.js";
import type { SessionStore } from "./SessionStore.js";
import { createProtocolHttpServer } from "./createProtocolHttpServer.js";
import type { FileSearchServiceContract } from "./FileSearchService.js";
import type { DockerExecutionConfig } from "../execution/index.js";
import type { GlobalEventQueue } from "./GlobalEventQueue.js";

describe("createProtocolHttpServer", () => {
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
        const { client, close } = await startServer();
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
            expect(health.catalog?.models.map((model) => model.id)).toContain(
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
                modelId: modelOpenaiGpt55.id,
            });

            const changed = await client.changeEffort(created.session.id, { effort: "high" });
            const events = await client.getEvents(created.session.id, created.session.lastEventId);

            expect(changed.session.effort).toBe("high");
            expect(events.events.at(-1)).toMatchObject({
                data: {
                    effort: "high",
                    modelId: modelOpenaiGpt55.id,
                },
                type: "effort_changed",
            });
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
                "Permission mode must be Auto, Workspace write, Read only, or Full access.",
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
                    event: { iteration: 0, type: "inference_iteration_start" },
                    runId: "run-1",
                },
                id: createEventId(),
                sessionId: created.session.id,
                type: "agent_event",
            };
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
            const durable = sessionResetEvent(created.session.id, createEventId());
            session?.events.append(cursor);
            session?.events.append(transient);
            session?.events.append(compaction);
            session?.events.append(durable);

            const initial = await client.getEvents(created.session.id);
            const catchup = await client.getEvents(created.session.id, cursor.id);

            expect(initial.events.map((event) => event.id)).not.toContain(transient.id);
            expect(initial.events.map((event) => event.id)).toContain(compaction.id);
            expect(initial.events.map((event) => event.id)).toContain(durable.id);
            expect(catchup.events.map((event) => event.id)).toEqual([
                transient.id,
                compaction.id,
                durable.id,
            ]);
        } finally {
            await close();
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
            await expect(client.shutdown()).resolves.toEqual({ shuttingDown: true });
            await new Promise((resolve) => setImmediate(resolve));

            expect(shutdownRequested).toBe(true);
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
        onDurableGlobalEventQueueChange?: (
            enabled: boolean,
        ) => GlobalEventQueue | undefined | Promise<GlobalEventQueue | undefined>;
        onShutdown?: () => void;
        store?: SessionStore;
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
        ...(options.onShutdown !== undefined ? { onShutdown: options.onShutdown } : {}),
        ...(options.onDurableGlobalEventQueueChange === undefined
            ? {}
            : {
                  onDurableGlobalEventQueueChange: options.onDurableGlobalEventQueueChange,
              }),
        store,
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
