import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { UserMessage } from "../agent/types.js";
import { createEventIdFactory, type ModelCatalog, type SessionEvent } from "../protocol/index.js";
import type { GymInferenceRequest } from "../providers/gym-types.js";
import { defineModel } from "../providers/types.js";
import type {
    InMemorySession,
    PersistedQueuedRun,
    PersistedSessionState,
} from "./InMemorySession.js";
import { PersistentSessionStore } from "./PersistentSessionStore.js";
import { TrackedTaskDrain } from "./TrackedTaskDrain.js";

describe("PersistentSessionStore", () => {
    it("resumes a durable external function after daemon restart without replaying its call", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "openai/gym",
            name: "Gym",
            thinkingLevels: ["off"],
        });
        const catalog: ModelCatalog = {
            defaultModelId: model.id,
            defaultProviderId: "gym",
            models: [model],
            providers: [{ models: [model], providerId: "gym" }],
        };
        const requests: GymInferenceRequest[] = [];
        const originalFetch = globalThis.fetch;
        const originalInferenceUrl = process.env.RIG_GYM_INFERENCE_URL;
        let store: PersistentSessionStore | undefined;
        try {
            process.env.RIG_GYM_INFERENCE_URL = "http://gym.test/inference";
            globalThis.fetch = async (_input, init) => {
                if (typeof init?.body !== "string") throw new Error("Expected request JSON.");
                requests.push(JSON.parse(init.body) as GymInferenceRequest);
                return new Response(
                    JSON.stringify(
                        requests.length === 1
                            ? {
                                  content: [
                                      {
                                          arguments: { ticket: 42 },
                                          id: "provider-call-1",
                                          name: "lookup_ticket",
                                          type: "toolCall",
                                      },
                                  ],
                              }
                            : { content: [{ text: "Ticket resolved.", type: "text" }] },
                    ),
                    { headers: { "content-type": "application/json" }, status: 200 },
                );
            };

            store = new PersistentSessionStore({ databasePath, modelCatalog: catalog });
            const session = store.create({
                cwd: "/tmp/rig-durable-external-tool",
                modelId: model.id,
                permissionMode: "full_access",
                providerId: "gym",
            });
            const submitted = session.submit({
                externalTools: [
                    {
                        description: "Looks up a ticket in the integrating system.",
                        name: "lookup_ticket",
                        parameters: {
                            additionalProperties: false,
                            properties: { ticket: { type: "number" } },
                            required: ["ticket"],
                            type: "object",
                        },
                    },
                ],
                systemPrompt: "Exact integration prompt.",
                text: "Resolve ticket 42.",
            });
            const pending = await waitForExternalToolCall(session);
            expect(requests[0]?.context.systemPrompt).toBe("Exact integration prompt.");
            expect(
                requests[0]?.context.tools?.find((tool) => tool.name === "lookup_ticket"),
            ).toMatchObject({
                description: "Looks up a ticket in the integrating system.",
                name: "lookup_ticket",
                parameters: { required: ["ticket"], type: "object" },
            });

            await store.prepareForShutdown("shutdown");
            store.close();
            store = undefined;

            store = new PersistentSessionStore({ databasePath, modelCatalog: catalog });
            const restored = store.get(session.id);
            if (restored === undefined) throw new Error("Expected restored session.");
            expect(restored.snapshot()).toMatchObject({
                pendingExternalToolCalls: [{ id: pending.id, status: "pending" }],
                status: "running",
                systemPrompt: "Exact integration prompt.",
            });

            expect(
                restored.resolveExternalToolCall(pending.id, {
                    output: { state: "resolved" },
                    status: "completed",
                }),
            ).toMatchObject({ accepted: true });
            await expect(restored.waitForRun(submitted.runId)).resolves.toEqual({
                status: "completed",
            });
            expect(requests).toHaveLength(2);
            expect(JSON.stringify(requests[1]?.context.messages)).toContain("resolved");
            expect(
                restored.resolveExternalToolCall(pending.id, {
                    output: { state: "resolved" },
                    status: "completed",
                }),
            ).toMatchObject({ accepted: false });
        } finally {
            store?.close();
            globalThis.fetch = originalFetch;
            if (originalInferenceUrl === undefined) delete process.env.RIG_GYM_INFERENCE_URL;
            else process.env.RIG_GYM_INFERENCE_URL = originalInferenceUrl;
            await cleanup();
        }
    });

    it("resumes a structured user question after daemon restart without replaying its call", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "openai/gym",
            name: "Gym",
            thinkingLevels: ["off"],
        });
        const catalog: ModelCatalog = {
            defaultModelId: model.id,
            defaultProviderId: "gym",
            models: [model],
            providers: [{ models: [model], providerId: "gym" }],
        };
        const requests: GymInferenceRequest[] = [];
        const originalFetch = globalThis.fetch;
        const originalInferenceUrl = process.env.RIG_GYM_INFERENCE_URL;
        let store: PersistentSessionStore | undefined;
        try {
            process.env.RIG_GYM_INFERENCE_URL = "http://gym.test/inference";
            globalThis.fetch = async (_input, init) => {
                if (typeof init?.body !== "string") throw new Error("Expected request JSON.");
                requests.push(JSON.parse(init.body) as GymInferenceRequest);
                return new Response(
                    JSON.stringify(
                        requests.length === 1
                            ? {
                                  content: [
                                      {
                                          arguments: {
                                              questions: [
                                                  {
                                                      header: "Database",
                                                      id: "database",
                                                      options: [
                                                          {
                                                              description: "Use PostgreSQL.",
                                                              label: "PostgreSQL",
                                                          },
                                                          {
                                                              description: "Use SQLite.",
                                                              label: "SQLite",
                                                          },
                                                      ],
                                                      question: "Which database should be used?",
                                                  },
                                              ],
                                          },
                                          id: "durable-question-one",
                                          name: "request_user_input",
                                          type: "toolCall",
                                      },
                                      {
                                          arguments: {
                                              questions: [
                                                  {
                                                      header: "Cache",
                                                      id: "cache",
                                                      options: [
                                                          {
                                                              description: "Use Redis.",
                                                              label: "Redis",
                                                          },
                                                          {
                                                              description: "Do not use a cache.",
                                                              label: "None",
                                                          },
                                                      ],
                                                      question: "Which cache should be used?",
                                                  },
                                              ],
                                          },
                                          id: "durable-question-two",
                                          name: "request_user_input",
                                          type: "toolCall",
                                      },
                                  ],
                              }
                            : { content: [{ text: "Question resolved.", type: "text" }] },
                    ),
                    { headers: { "content-type": "application/json" }, status: 200 },
                );
            };

            store = new PersistentSessionStore({ databasePath, modelCatalog: catalog });
            const session = store.create({
                cwd: "/tmp/rig-durable-user-input",
                modelId: model.id,
                permissionMode: "full_access",
                providerId: "gym",
            });
            const submitted = session.submit({ text: "Choose a database." });
            await waitForPendingUserInputs(session, 2);

            await store.prepareForShutdown("shutdown");
            store.close();
            store = undefined;

            store = new PersistentSessionStore({ databasePath, modelCatalog: catalog });
            const restored = store.get(session.id);
            if (restored === undefined) throw new Error("Expected restored session.");
            expect(restored.snapshot()).toMatchObject({
                pendingUserInputs: [
                    { requestId: "durable-question-one" },
                    { requestId: "durable-question-two" },
                ],
                status: "running",
            });

            const databaseAnswer = { answers: { database: ["PostgreSQL"] } };
            const cacheAnswer = { answers: { cache: ["Redis"] } };
            expect(restored.answerUserInput("durable-question-two", cacheAnswer)).toBeDefined();
            expect(restored.answerUserInput("durable-question-one", databaseAnswer)).toBeDefined();
            await expect(restored.waitForRun(submitted.runId)).resolves.toEqual({
                status: "completed",
            });
            expect(requests).toHaveLength(2);
            expect(requests[1]?.context.messages.slice(-2)).toMatchObject([
                {
                    content: [
                        {
                            text: '{"answers":{"database":{"answers":["PostgreSQL"]}}}',
                            type: "text",
                        },
                    ],
                    role: "toolResult",
                    toolCallId: "durable-question-one",
                },
                {
                    content: [
                        {
                            text: '{"answers":{"cache":{"answers":["Redis"]}}}',
                            type: "text",
                        },
                    ],
                    role: "toolResult",
                    toolCallId: "durable-question-two",
                },
            ]);
            expect(restored.answerUserInput("durable-question-one", databaseAnswer)).toBeDefined();
            expect(() =>
                restored.answerUserInput("durable-question-one", {
                    answers: { database: ["SQLite"] },
                }),
            ).toThrow("already has a different answer");
        } finally {
            store?.close();
            globalThis.fetch = originalFetch;
            if (originalInferenceUrl === undefined) delete process.env.RIG_GYM_INFERENCE_URL;
            else process.env.RIG_GYM_INFERENCE_URL = originalInferenceUrl;
            await cleanup();
        }
    });

    it("resumes a durable skill request with its configured metadata after restart", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "openai/gym",
            name: "Gym",
            thinkingLevels: ["off"],
        });
        const catalog: ModelCatalog = {
            defaultModelId: model.id,
            defaultProviderId: "gym",
            models: [model],
            providers: [{ models: [model], providerId: "gym" }],
        };
        const requests: GymInferenceRequest[] = [];
        const originalFetch = globalThis.fetch;
        const originalInferenceUrl = process.env.RIG_GYM_INFERENCE_URL;
        let store: PersistentSessionStore | undefined;
        try {
            process.env.RIG_GYM_INFERENCE_URL = "http://gym.test/inference";
            globalThis.fetch = async (_input, init) => {
                if (typeof init?.body !== "string") throw new Error("Expected request JSON.");
                requests.push(JSON.parse(init.body) as GymInferenceRequest);
                return new Response(
                    JSON.stringify(
                        requests.length === 1
                            ? {
                                  content: [
                                      {
                                          arguments: { name: "release-check" },
                                          id: "provider-skill-call-1",
                                          name: "read_skill",
                                          type: "toolCall",
                                      },
                                  ],
                              }
                            : { content: [{ text: "Release checked.", type: "text" }] },
                    ),
                    { headers: { "content-type": "application/json" }, status: 200 },
                );
            };

            store = new PersistentSessionStore({ databasePath, modelCatalog: catalog });
            const session = store.create({
                cwd: "/tmp/rig-durable-skill",
                modelId: model.id,
                permissionMode: "full_access",
                providerId: "gym",
            });
            const submitted = session.submit({
                skills: [
                    {
                        description: "Check a release using integration-owned instructions.",
                        location: "durable",
                        name: "release-check",
                    },
                ],
                systemPrompt: "Exact integration prompt.",
                text: "Use the release-check skill.",
            });
            const pending = await waitForExternalToolCall(session);
            expect(pending).toMatchObject({
                arguments: { name: "release-check" },
                skill: { location: "durable", name: "release-check" },
            });
            expect(requests[0]?.context.systemPrompt).toContain("Exact integration prompt.");
            expect(requests[0]?.context.systemPrompt).toContain("<name>release-check</name>");
            expect(
                requests[0]?.context.tools?.find((tool) => tool.name === "read_skill"),
            ).toMatchObject({ parameters: { required: ["name"], type: "object" } });

            await store.prepareForShutdown("shutdown");
            store.close();
            store = undefined;

            store = new PersistentSessionStore({ databasePath, modelCatalog: catalog });
            const restored = store.get(session.id);
            if (restored === undefined) throw new Error("Expected restored session.");
            expect(restored.snapshot()).toMatchObject({
                pendingExternalToolCalls: [
                    {
                        id: pending.id,
                        skill: { location: "durable", name: "release-check" },
                        status: "pending",
                    },
                ],
                skills: [{ location: "durable", name: "release-check" }],
                status: "running",
            });

            expect(
                restored.resolveExternalToolCall(pending.id, {
                    output: "# Release check\nDURABLE_SKILL_BODY_SENTINEL",
                    status: "completed",
                }),
            ).toMatchObject({ accepted: true });
            await expect(restored.waitForRun(submitted.runId)).resolves.toEqual({
                status: "completed",
            });
            expect(requests).toHaveLength(2);
            expect(JSON.stringify(requests[1]?.context.messages)).toContain(
                "DURABLE_SKILL_BODY_SENTINEL",
            );
        } finally {
            store?.close();
            globalThis.fetch = originalFetch;
            if (originalInferenceUrl === undefined) delete process.env.RIG_GYM_INFERENCE_URL;
            else process.env.RIG_GYM_INFERENCE_URL = originalInferenceUrl;
            await cleanup();
        }
    });

    it("retains a bounded external call history without pruning pending work", () => {
        const store = new PersistentSessionStore({ databasePath: ":memory:" });
        const state = sessionState();
        store.saveSession(state);
        try {
            for (let index = 0; index < 1_002; index += 1) {
                store.upsertExternalToolCall({
                    arguments: { index },
                    batchId: `batch-${index}`,
                    consumed: true,
                    createdAt: index,
                    definition: {
                        description: "Looks up a ticket.",
                        name: "lookup_ticket",
                        parameters: { type: "object" },
                    },
                    id: `completed-${index}`,
                    resolution: { output: { index }, status: "completed" },
                    resolvedAt: index,
                    runId: `run-${index}`,
                    sessionId: state.id,
                    status: "completed",
                    toolCallId: `tool-${index}`,
                    toolCallIndex: 0,
                });
            }
            store.upsertExternalToolCall({
                arguments: {},
                batchId: "pending-batch",
                consumed: false,
                createdAt: -1,
                definition: {
                    description: "Waits for a callback.",
                    name: "wait_for_callback",
                    parameters: { type: "object" },
                },
                id: "pending-call",
                runId: "pending-run",
                sessionId: state.id,
                status: "pending",
                toolCallId: "pending-tool",
                toolCallIndex: 0,
            });

            store.pruneExternalToolCalls(state.id, 1_000);

            const calls = store.listExternalToolCalls({ limit: 2_000 });
            expect(calls).toHaveLength(1_001);
            expect(calls.some((call) => call.id === "pending-call")).toBe(true);
            expect(calls.some((call) => call.id === "completed-0")).toBe(false);
            expect(calls.some((call) => call.id === "completed-1001")).toBe(true);
        } finally {
            store.close();
        }
    });

    it("restores appended system prompts after reopening SQLite", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const session = store.create({
                appendSystemPrompt: "Persisted API instructions.",
                cwd: "/tmp/rig-persistent-prompt-test",
            });
            session.update({ appendSystemPrompt: "Updated persisted instructions." });
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const restored = restoredStore.get(session.id);
                expect(restored?.snapshot().appendSystemPrompt).toBe(
                    "Updated persisted instructions.",
                );
                expect(restored?.requestForSubagent().appendSystemPrompt).toBe(
                    "Updated persisted instructions.",
                );
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("delivers transient inference events live without writing session event rows", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const session = store.create({ cwd: "/tmp/rig-persistent-session-test" });
            const transient = sessionEvent(session.id, "transient-text", "agent_event", {
                event: { contentIndex: 0, delta: "token", partial: {}, type: "text_delta" },
                runId: "run-1",
            });
            const processChanged = sessionEvent(session.id, "process-changed", "agent_event", {
                event: { running: 1, type: "background_processes_changed" },
                runId: "run-1",
            });
            const compacted = sessionEvent(session.id, "context-compacted", "agent_event", {
                event: {
                    compactedMessageCount: 4,
                    estimatedTokensAfter: 600,
                    estimatedTokensBefore: 4_200,
                    reason: "threshold",
                    type: "context_compacted",
                },
                runId: "run-1",
            });
            const delivered: SessionEvent[] = [];
            session.events.subscribe((event) => delivered.push(event));

            session.events.append(transient);
            session.events.append(processChanged);
            session.events.append(compacted);

            expect(session.events.since(undefined)?.map((event) => event.id)).toEqual([
                expect.any(String),
                processChanged.id,
                compacted.id,
            ]);
            expect(delivered.map((event) => event.id)).toEqual([
                transient.id,
                processChanged.id,
                compacted.id,
            ]);
            const database = new DatabaseSync(databasePath, { readOnly: true });
            try {
                const rows = database
                    .prepare(
                        "SELECT event_id FROM session_events WHERE session_id = ? ORDER BY seq",
                    )
                    .all(session.id) as Array<{ event_id: string }>;
                expect(rows.map((row) => row.event_id)).toEqual([
                    expect.any(String),
                    processChanged.id,
                    compacted.id,
                ]);
            } finally {
                database.close();
            }
            store.close();
        } finally {
            await cleanup();
        }
    });

    it("restores secret registrations and source-scoped attachments after reopening SQLite", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            store.registerSecret({
                description: "Service API credentials",
                environment: {
                    SERVICE_REGION: "persisted-region",
                    SERVICE_TOKEN: "persisted-token",
                },
                id: "service",
            });
            store.registerSecret({
                description: "Project service credentials",
                environment: { PROJECT_TOKEN: "persisted-project-token" },
                id: "project-service",
            });
            const session = store.create({
                cwd: "/tmp/rig-secret-session",
                secretIds: ["service"],
            });
            store.attachSecret(session.id, "project-service", "project");
            expect(session.snapshot()).toMatchObject({
                projectSecretIds: ["project-service"],
                secretIds: ["project-service", "service"],
                sessionSecretIds: ["service"],
            });
            expect(session.requestForSubagent()).not.toHaveProperty("secretIds");
            store.close();

            const database = new DatabaseSync(databasePath);
            const sessionRow = database
                .prepare("SELECT secret_ids_json FROM sessions WHERE id = ?")
                .get(session.id) as { secret_ids_json: string };
            const registrationRow = database
                .prepare(
                    "SELECT description, environment_json FROM secret_registrations WHERE id = ?",
                )
                .get("service") as { description: string; environment_json: string };
            expect(sessionRow.secret_ids_json).toBe('["service"]');
            expect(registrationRow.description).toBe("Service API credentials");
            expect(JSON.parse(registrationRow.environment_json)).toEqual({
                SERVICE_REGION: "persisted-region",
                SERVICE_TOKEN: "persisted-token",
            });
            database.close();

            let restoredEnvironment: NodeJS.ProcessEnv | undefined;
            const restoredStore = new PersistentSessionStore({
                databasePath,
                createRuntime: (options) => {
                    restoredEnvironment = options.secrets?.resolve(["project-service", "service"]);
                    throw new Error("Captured restored secret environment.");
                },
            });
            try {
                expect(restoredStore.listSecrets()).toEqual([
                    {
                        description: "Project service credentials",
                        environmentVariables: ["PROJECT_TOKEN"],
                        id: "project-service",
                    },
                    {
                        description: "Service API credentials",
                        environmentVariables: ["SERVICE_REGION", "SERVICE_TOKEN"],
                        id: "service",
                    },
                ]);
                const restoredSession = restoredStore.get(session.id);
                if (restoredSession === undefined) throw new Error("Expected restored session.");
                await expect(restoredSession.compact()).rejects.toThrow(
                    "Captured restored secret environment.",
                );
                expect(restoredEnvironment).toEqual({
                    PROJECT_TOKEN: "persisted-project-token",
                    SERVICE_REGION: "persisted-region",
                    SERVICE_TOKEN: "persisted-token",
                });
                expect(restoredSession.snapshot()).toMatchObject({
                    projectSecretIds: ["project-service"],
                    secretIds: ["project-service", "service"],
                    sessionSecretIds: ["service"],
                });

                const fork = restoredStore.fork(session.id);
                expect(fork?.snapshot()).toMatchObject({
                    projectSecretIds: ["project-service"],
                    secretIds: ["project-service"],
                    sessionSecretIds: [],
                });
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("conservatively restores null, missing, and unknown agent event subtypes", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const sessionId = store.create({ cwd: "/tmp/rig-persistent-session-test" }).id;
            store.close();

            const database = new DatabaseSync(databasePath);
            insertSessionEvent(database, sessionId, "null-subtype", "agent_event", {
                event: { type: null },
                runId: "run-1",
            });
            insertSessionEvent(database, sessionId, "missing-subtype", "agent_event", {
                event: {},
                runId: "run-1",
            });
            insertSessionEvent(database, sessionId, "unknown-subtype", "agent_event", {
                event: { type: "future_provider_event" },
                runId: "run-1",
            });
            database.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                expect(
                    restoredStore
                        .get(sessionId)
                        ?.events.since(undefined)
                        ?.map((event) => event.id),
                ).toEqual([
                    expect.any(String),
                    "null-subtype",
                    "missing-subtype",
                    "unknown-subtype",
                ]);
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("restores historical masking destinations after rotating a registration", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            store.registerSecret({
                description: "Initial service credentials",
                environment: { OLD_SERVICE_TOKEN: "old" },
                id: "service",
            });
            const session = store.create({
                cwd: "/tmp/rotated-secret-session",
                secretIds: ["service"],
            });
            store.registerSecret({
                description: "Rotated service credentials",
                environment: { NEW_SERVICE_TOKEN: "new" },
                id: "service",
            });
            store.close();

            let restoredDestinations: readonly string[] | undefined;
            const restoredStore = new PersistentSessionStore({
                databasePath,
                createRuntime: (options) => {
                    restoredDestinations = options.secrets?.environmentVariables();
                    throw new Error("Captured restored masking destinations.");
                },
            });
            try {
                const restoredSession = restoredStore.get(session.id);
                if (restoredSession === undefined) throw new Error("Expected restored session.");
                await expect(restoredSession.compact()).rejects.toThrow(
                    "Captured restored masking destinations.",
                );
                expect(restoredDestinations).toHaveLength(2);
                expect(restoredDestinations).toEqual(
                    expect.arrayContaining(["OLD_SERVICE_TOKEN", "NEW_SERVICE_TOKEN"]),
                );
                expect(restoredStore.listSecrets()).toEqual([
                    {
                        description: "Rotated service credentials",
                        environmentVariables: ["NEW_SERVICE_TOKEN"],
                        id: "service",
                    },
                ]);
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("recovers a transient event cursor across restart without replaying durable history", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const session = store.create({ cwd: "/tmp/rig-persistent-session-test" });
            const otherSession = store.create({ cwd: "/tmp/rig-other-session-test" });
            const otherSessionCursor = otherSession.snapshot().lastEventId;
            if (otherSessionCursor === undefined) throw new Error("Expected another cursor.");
            const currentCursor = session.snapshot().lastEventId;
            if (currentCursor === undefined) throw new Error("Expected a session cursor.");
            const createFutureEventId = createEventIdFactory({
                after: currentCursor,
                now: () => Date.now() + 60_000,
            });
            const transient = sessionEvent(session.id, createFutureEventId(), "agent_event", {
                event: { contentIndex: 0, delta: "live", partial: {}, type: "text_delta" },
                runId: "run-1",
            });
            session.events.append(transient);
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const restored = restoredStore.get(session.id);
                expect(restored?.snapshot().lastEventId).toBe(transient.id);
                expect(restored?.events.since(transient.id)).toEqual([]);
                expect(restored?.events.since(otherSessionCursor)).toBeUndefined();

                await restored?.changePermissionMode({ permissionMode: "read_only" });
                const catchup = restored?.events.since(transient.id);
                expect(catchup?.map((event) => event.type)).toContain("permission_mode_changed");
                expect(catchup?.every((event) => event.id > transient.id)).toBe(true);
                expect(new Set(catchup?.map((event) => event.id)).size).toBe(catchup?.length);
                expect(restored?.events.since(transient.id)).toEqual(catchup);
                expect(restored?.events.since(otherSessionCursor)).toBeUndefined();
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("persists registration removal and clears session and project attachments", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            store.registerSecret({
                description: "Disposable credentials",
                environment: { DISPOSABLE_TOKEN: "removed-value" },
                id: "disposable",
            });
            const session = store.create({
                cwd: "/tmp/removed-secret-project",
                secretIds: ["disposable"],
            });
            store.attachSecret(session.id, "disposable", "project");
            expect(store.unregisterSecret("disposable")).toBe(true);
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                expect(restoredStore.listSecrets()).toEqual([]);
                expect(restoredStore.get(session.id)?.snapshot()).toMatchObject({
                    projectSecretIds: [],
                    secretIds: [],
                    sessionSecretIds: [],
                });
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("keeps Docker execution settings across daemon restarts", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const session = store.create({
                cwd: "/host/project",
                docker: {
                    environment: { PROJECT_MODE: "test" },
                    image: "local/image:tag",
                    mounts: [{ source: "/host/project", target: "/workspace" }],
                    workingDirectory: "/workspace",
                },
            });
            expect(store.fork(session.id)?.requestForSubagent().docker?.name).toBe(
                `rig-${session.id}`,
            );
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                expect(restoredStore.get(session.id)?.requestForSubagent().docker).toEqual({
                    environment: { PROJECT_MODE: "test" },
                    image: "local/image:tag",
                    mounts: [{ source: "/host/project", target: "/workspace" }],
                    name: `rig-${session.id}`,
                    workingDirectory: "/workspace",
                });
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("keeps the global event queue disabled unless explicitly enabled", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            store.create({ cwd: "/tmp/rig-persistent-session-test" });
            expect(store.globalEventQueue).toBeUndefined();
            store.close();

            const enabledStore = new PersistentSessionStore({
                databasePath,
                durableGlobalEventQueue: true,
            });
            expect(enabledStore.globalEventQueue?.list()).toEqual([]);
            const queuedSession = enabledStore.create({
                cwd: "/tmp/rig-persistent-session-test-enabled",
            });
            enabledStore.close();

            const disabledStore = new PersistentSessionStore({ databasePath });
            disabledStore.create({ cwd: "/tmp/rig-persistent-session-test-disabled" });
            disabledStore.close();

            const restoredStore = new PersistentSessionStore({
                databasePath,
                durableGlobalEventQueue: true,
            });
            try {
                expect(restoredStore.globalEventQueue?.list()).toEqual([
                    expect.objectContaining({
                        event: expect.objectContaining({ sessionId: queuedSession.id }),
                    }),
                ]);
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("persists and trims global events independently from session history", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({
                databasePath,
                durableGlobalEventQueue: true,
            });
            const firstSession = store.create({ cwd: "/tmp/rig-persistent-session-test-a" });
            const secondSession = store.create({ cwd: "/tmp/rig-persistent-session-test-b" });
            const initial = store.globalEventQueue?.list() ?? [];

            expect(initial.map((entry) => entry.event.sessionId)).toEqual([
                firstSession.id,
                secondSession.id,
            ]);
            const firstCursor = initial[0]?.cursor;
            const secondCursor = initial[1]?.cursor;
            expect(firstCursor).toBeDefined();
            expect(secondCursor).toBeDefined();
            if (firstCursor === undefined || secondCursor === undefined) {
                throw new Error("Expected two global event cursors.");
            }
            expect(store.globalEventQueue?.trim(firstCursor)).toEqual({
                trimmed: 1,
                through: firstCursor,
            });
            expect(store.globalEventQueue?.trim(firstCursor)).toEqual({
                trimmed: 0,
                through: firstCursor,
            });
            expect(store.globalEventQueue?.list({ after: 0 })).toBeUndefined();
            expect(firstSession.events.since(undefined)).toHaveLength(1);
            store.close();

            const restoredStore = new PersistentSessionStore({
                databasePath,
                durableGlobalEventQueue: true,
            });
            try {
                expect(restoredStore.globalEventQueue?.list()).toEqual([
                    expect.objectContaining({
                        cursor: secondCursor,
                        event: expect.objectContaining({ sessionId: secondSession.id }),
                    }),
                ]);
                const thirdSession = restoredStore.create({
                    cwd: "/tmp/rig-persistent-session-test-c",
                });
                const appended = restoredStore.globalEventQueue?.list({ after: secondCursor });
                expect(appended).toEqual([
                    expect.objectContaining({
                        event: expect.objectContaining({ sessionId: thirdSession.id }),
                    }),
                ]);
                expect(appended?.[0]?.cursor).toBeGreaterThan(secondCursor);
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("restores persisted session state and messages without creating a runtime", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const state = sessionState({
                status: "completed",
            });
            const userMessage = textUserMessage("message-1", "persist me");
            store.saveSession(state);
            store.upsertMessage(state.id, {
                isPartial: false,
                message: userMessage,
                position: 0,
                runId: "run-1",
            });
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const restored = restoredStore.get(state.id);

                expect(restored?.snapshot().status).toBe("completed");
                expect(restored?.snapshot().snapshot.messages).toEqual([userMessage]);
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("does not parse persisted event payloads while opening the database", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const session = store.create({ cwd: "/tmp/rig-startup-event-scan-test" });
            store.close();

            const database = new DatabaseSync(databasePath);
            database
                .prepare(
                    `
                    INSERT INTO session_events (
                        session_id, event_id, type, created_at_ms, data_json
                    ) VALUES (?, ?, ?, ?, ?)
                    `,
                )
                .run(session.id, "unreadable-event", "run_started", 1, "{");
            database.close();

            const reopened = new PersistentSessionStore({ databasePath });
            try {
                expect(reopened.list().map((entry) => entry.id)).toContain(session.id);
            } finally {
                reopened.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("reconciles a durable terminal event without appending a startup error", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const state = sessionState({
                activeRunId: "completed-before-crash",
                status: "running",
            });
            const store = new PersistentSessionStore({ databasePath });
            store.saveSession(state);
            store.close();
            const database = new DatabaseSync(databasePath);
            insertEvent(database, state.id, "durable-finish", "run_finished", 10, {
                agentRunId: "agent-run",
                modelLocked: false,
                runId: "completed-before-crash",
                stopReason: "stop",
            });
            database.close();

            const reopened = new PersistentSessionStore({ databasePath });
            reopened.close();

            const verify = new DatabaseSync(databasePath);
            try {
                expect(
                    verify
                        .prepare("SELECT status, active_run_id FROM sessions WHERE id = ?")
                        .get(state.id),
                ).toEqual({ active_run_id: null, status: "completed" });
                expect(
                    verify
                        .prepare(
                            "SELECT COUNT(*) AS count FROM session_events WHERE session_id = ? AND type = 'run_error'",
                        )
                        .get(state.id),
                ).toEqual({ count: 0 });
            } finally {
                verify.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("does not promote active steering after restart interruption, including on reopen", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const active = textUserMessage("active-orphan", "still active at restart");
            const state = sessionState({
                activeRunId: "active-run",
                modelId: "openai/test",
                models: testModelCatalog().models,
                providerId: "codex",
                status: "running",
            });
            const store = new PersistentSessionStore({
                databasePath,
                modelCatalog: testModelCatalog(),
            });
            store.saveSession(state);
            store.close();
            const database = new DatabaseSync(databasePath);
            insertEvent(database, state.id, "active-start", "run_started", 1, {
                runId: "active-run",
            });
            insertEvent(database, state.id, "active-submit", "message_submitted", 2, {
                delivery: "steer",
                displayText: "still active at restart",
                message: active,
                runId: "active-run",
            });
            database.close();

            for (let open = 0; open < 2; open += 1) {
                const restored = new PersistentSessionStore({
                    databasePath,
                    modelCatalog: testModelCatalog(),
                    now: () => 100 + open,
                });
                restored.close();
                const verify = new DatabaseSync(databasePath);
                try {
                    expect(
                        verify
                            .prepare(
                                "SELECT COUNT(*) AS count FROM session_messages WHERE session_id = ? AND message_id = ?",
                            )
                            .get(state.id, active.id),
                    ).toEqual({ count: 0 });
                    expect(
                        verify
                            .prepare(
                                "SELECT COUNT(*) AS count FROM session_events WHERE session_id = ? AND type = 'steering_applied'",
                            )
                            .get(state.id),
                    ).toEqual({ count: 0 });
                    const restartErrors = verify
                        .prepare(
                            "SELECT data_json FROM session_events WHERE session_id = ? AND type = 'run_error'",
                        )
                        .all(state.id) as { data_json: string }[];
                    expect(restartErrors.map((row) => JSON.parse(row.data_json))).toEqual([
                        expect.objectContaining({
                            runId: "active-run",
                            startupInterruption: true,
                        }),
                    ]);
                } finally {
                    verify.close();
                }
            }
        } finally {
            await cleanup();
        }
    });

    it("keeps restart-interrupted steering excluded after a later run clears interruption state", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const active = textUserMessage("restart-orphan", "never reached inference");
            const later = textUserMessage("later-run-message", "completed after restart");
            const state = sessionState({
                activeRunId: "crashed-run",
                modelId: "openai/test",
                models: testModelCatalog().models,
                providerId: "codex",
                status: "running",
            });
            const store = new PersistentSessionStore({
                databasePath,
                modelCatalog: testModelCatalog(),
            });
            store.saveSession(state);
            store.close();
            const database = new DatabaseSync(databasePath);
            insertEvent(database, state.id, "crashed-start", "run_started", 1, {
                runId: "crashed-run",
            });
            insertEvent(database, state.id, "crashed-steer", "message_submitted", 2, {
                delivery: "steer",
                displayText: "never reached inference",
                message: active,
                runId: "crashed-run",
            });
            database.close();

            const firstReopen = new PersistentSessionStore({
                databasePath,
                modelCatalog: testModelCatalog(),
                now: () => 100,
            });
            firstReopen.close();

            const laterDatabase = new DatabaseSync(databasePath);
            insertEvent(laterDatabase, state.id, "later-start", "run_started", 4, {
                runId: "later-run",
            });
            insertEvent(laterDatabase, state.id, "later-submit", "message_submitted", 5, {
                delivery: "run",
                displayText: "completed after restart",
                message: later,
                runId: "later-run",
            });
            insertEvent(laterDatabase, state.id, "later-finished", "run_finished", 6, {
                agentRunId: "later-agent-run",
                modelLocked: true,
                runId: "later-run",
                stopReason: "stop",
            });
            laterDatabase
                .prepare(
                    "UPDATE sessions SET status = 'completed', active_run_id = NULL, interrupted = 0, interruption_json = NULL WHERE id = ?",
                )
                .run(state.id);
            laterDatabase.close();

            const secondReopen = new PersistentSessionStore({
                databasePath,
                modelCatalog: testModelCatalog(),
                now: () => 200,
            });
            secondReopen.close();

            const verify = new DatabaseSync(databasePath);
            try {
                expect(
                    verify
                        .prepare(
                            "SELECT COUNT(*) AS count FROM session_messages WHERE session_id = ? AND message_id = ?",
                        )
                        .get(state.id, active.id),
                ).toEqual({ count: 0 });
                expect(
                    verify
                        .prepare(
                            "SELECT COUNT(*) AS count FROM session_events WHERE session_id = ? AND type = 'steering_applied'",
                        )
                        .get(state.id),
                ).toEqual({ count: 0 });
                const crashError = verify
                    .prepare(
                        "SELECT data_json FROM session_events WHERE session_id = ? AND type = 'run_error'",
                    )
                    .get(state.id) as { data_json: string };
                expect(JSON.parse(crashError.data_json)).toEqual(
                    expect.objectContaining({
                        runId: "crashed-run",
                        startupInterruption: true,
                    }),
                );
            } finally {
                verify.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("does not promote suspended subagent steering on the second restart", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const active = textUserMessage("suspended-orphan", "not applied before suspension");
            const store = new PersistentSessionStore({
                databasePath,
                modelCatalog: testModelCatalog(),
            });
            store.saveSession(sessionState());
            const state = sessionState({
                activeRunId: "suspended-run",
                agent: {
                    depth: 1,
                    description: "Wait for more work",
                    parentSessionId: "session-1",
                    rootSessionId: "session-1",
                    type: "subagent",
                },
                agentId: "subagent-agent",
                id: "subagent-1",
                status: "suspended",
            });
            store.saveSession(state);
            store.close();
            const database = new DatabaseSync(databasePath);
            insertEvent(database, state.id, "suspended-start", "run_started", 1, {
                runId: "suspended-run",
            });
            insertEvent(database, state.id, "suspended-submit", "message_submitted", 2, {
                delivery: "steer",
                displayText: "not applied before suspension",
                message: active,
                runId: "suspended-run",
            });
            database.close();

            for (let open = 0; open < 2; open += 1) {
                const restored = new PersistentSessionStore({
                    databasePath,
                    modelCatalog: testModelCatalog(),
                });
                restored.close();
            }

            const verify = new DatabaseSync(databasePath);
            try {
                expect(
                    verify
                        .prepare(
                            "SELECT COUNT(*) AS count FROM session_messages WHERE session_id = ? AND message_id = ?",
                        )
                        .get(state.id, active.id),
                ).toEqual({ count: 0 });
                expect(
                    verify
                        .prepare(
                            "SELECT COUNT(*) AS count FROM session_events WHERE session_id = ? AND type = 'steering_applied'",
                        )
                        .get(state.id),
                ).toEqual({ count: 0 });
                const restartError = verify
                    .prepare(
                        "SELECT data_json FROM session_events WHERE session_id = ? AND type = 'run_error'",
                    )
                    .get(state.id) as { data_json: string };
                expect(JSON.parse(restartError.data_json)).toEqual(
                    expect.objectContaining({
                        runId: "suspended-run",
                        startupInterruption: true,
                    }),
                );
            } finally {
                verify.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("keeps workflows disabled across daemon restarts", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const sessionId = store.create({
                cwd: "/tmp/rig-persistent-session-test",
                workflowsEnabled: false,
            }).id;
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const restored = restoredStore.get(sessionId);
                expect(restored?.snapshot().workflowsEnabled).toBe(false);
                expect(() =>
                    restored?.launchWorkflow({
                        code: "42",
                        description: "Must stay disabled",
                        execute: async () => ({ agentCalls: [], output: 42 }),
                        name: "disabled-workflow",
                    }),
                ).toThrow("Workflows are disabled for this session.");
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("persists a Monty checkpoint and completed workflow calls across daemon restarts", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const state = sessionState({
                workflows: [
                    {
                        agentCalls: [{ output: "cached", signature: "cached-signature" }],
                        checkpoint: {
                            nextAgentCallIndex: 1,
                            phase: "Verify",
                            snapshotBase64: Buffer.from([1, 2, 3]).toString("base64"),
                        },
                        state: {
                            agentCount: 1,
                            code: 'agent("check")',
                            description: "Persist checkpoint",
                            logs: [],
                            name: "persist-checkpoint",
                            runId: "workflow-before-restart",
                            startedAt: 1,
                            status: "running",
                            taskId: "workflow:workflow-before-restart",
                        },
                    },
                ],
            });
            store.saveSession(state);
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const restored = restoredStore.get(state.id);
                expect(restored?.getWorkflow("workflow-before-restart")).toMatchObject({
                    error: "The workflow was interrupted when the local server stopped.",
                    status: "stopped",
                });
                let receivedCheckpoint: unknown;
                let receivedAgentCalls: readonly unknown[] = [];
                restored?.launchWorkflow({
                    code: 'agent("check")',
                    description: "Resume checkpoint",
                    execute: async (options) => {
                        receivedCheckpoint = options.resumeCheckpoint;
                        receivedAgentCalls = options.resumeAgentCalls;
                        return { agentCalls: options.resumeAgentCalls, output: "resumed" };
                    },
                    name: "persist-checkpoint",
                    resumeFromRunId: "workflow-before-restart",
                });
                await new Promise((resolve) => setImmediate(resolve));

                expect(receivedCheckpoint).toMatchObject({
                    nextAgentCallIndex: 1,
                    phase: "Verify",
                    snapshot: new Uint8Array([1, 2, 3]),
                });
                expect(receivedAgentCalls).toEqual([
                    { output: "cached", signature: "cached-signature" },
                ]);
                const notificationRun = restored?.events
                    .since(undefined)
                    ?.findLast((event) => event.type === "run_started");
                if (notificationRun?.type !== "run_started") {
                    throw new Error("Expected the completed workflow notification to start a run.");
                }
                await restored?.abort();
                await restored?.waitForRun(notificationRun.data.runId);
                await new Promise((resolve) => setImmediate(resolve));
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("persists a rewound transcript across daemon restarts", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const messages = [
                textUserMessage("message-1", "Keep this"),
                textUserMessage("message-2", "Rewind this"),
                textUserMessage("message-3", "Remove this too"),
            ];
            const store = new PersistentSessionStore({ databasePath });
            const state = sessionState({ contextMessages: messages, status: "completed" });
            store.saveSession(state);
            messages.forEach((message, position) => {
                store.upsertMessage(state.id, {
                    isPartial: false,
                    message,
                    position,
                    runId: `run-${position + 1}`,
                });
            });
            store.close();

            const rewindStore = new PersistentSessionStore({ databasePath });
            rewindStore.get(state.id)?.rewind("message-2");
            rewindStore.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const restored = restoredStore.get(state.id)?.snapshot().snapshot;
                expect(restored?.messages).toEqual([messages[0]]);
                expect(restored?.contextMessages).toBeUndefined();
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("restores compacted model context separately from the visible transcript", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        const summaryMessage = textUserMessage(
            "summary-1",
            "<conversation_summary>Earlier work.</conversation_summary>",
        );
        try {
            const store = new PersistentSessionStore({ databasePath });
            const state = sessionState({ contextMessages: [summaryMessage] });
            store.saveSession(state);
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const restored = restoredStore.get(state.id);

                expect(restored?.snapshot().snapshot.messages).toEqual([]);
                expect(restored?.snapshot().snapshot.contextMessages).toEqual([summaryMessage]);
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("persists internal context messages without exposing them in the session snapshot", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        const internalContinuation: UserMessage = {
            blocks: [{ text: "Continue after the inference crash.", type: "text" }],
            id: "internal-crash-continuation",
            internal: true,
            role: "user",
        };
        try {
            const store = new PersistentSessionStore({ databasePath });
            const state = sessionState({ contextMessages: [internalContinuation] });
            store.saveSession(state);
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const restored = restoredStore.get(state.id);

                expect(restored?.state().contextMessages).toEqual([internalContinuation]);
                expect(restored?.snapshot().snapshot.messages).toEqual([]);
                expect(restored?.snapshot().snapshot.contextMessages).toEqual([]);
                expect(JSON.stringify(restored?.events.since(undefined))).not.toContain(
                    "Continue after the inference crash.",
                );
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("checkpoints Claude's internal crash continuation before the retry completes", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "anthropic/sonnet-4-6",
            name: "Claude Test",
            thinkingLevels: ["off"],
        });
        const catalog: ModelCatalog = {
            defaultModelId: model.id,
            defaultProviderId: "claude",
            models: [model],
            providers: [{ models: [model], providerId: "claude" }],
        };
        const originalFetch = globalThis.fetch;
        const originalInferenceUrl = process.env.RIG_GYM_INFERENCE_URL;
        const originalOverrides = process.env.RIG_GYM_PROVIDER_OVERRIDES;
        const requests: GymInferenceRequest[] = [];
        let releaseContinuation: (response: Response) => void = () => {};
        const continuation = new Promise<Response>((resolve) => {
            releaseContinuation = resolve;
        });
        let store: PersistentSessionStore | undefined;
        try {
            process.env.RIG_GYM_INFERENCE_URL = "http://gym.test/inference";
            process.env.RIG_GYM_PROVIDER_OVERRIDES = "claude";
            globalThis.fetch = async (_input, init) => {
                if (typeof init?.body !== "string") throw new Error("Expected request JSON.");
                requests.push(JSON.parse(init.body) as GymInferenceRequest);
                if (requests.length === 1) {
                    return new Response(
                        JSON.stringify({
                            content: [{ text: "DURABLE_PARTIAL_UNSENT", type: "text" }],
                            errorAfterTextDeltas: 1,
                            errorMessage: "WebSocket error",
                            stopReason: "error",
                            textDeltaChunkSize: 15,
                        }),
                        { headers: { "content-type": "application/json" }, status: 200 },
                    );
                }
                if (requests.length === 2) return continuation;
                return new Response(
                    JSON.stringify({ content: [{ text: "Recovered session", type: "text" }] }),
                    { headers: { "content-type": "application/json" }, status: 200 },
                );
            };

            store = new PersistentSessionStore({ databasePath, modelCatalog: catalog });
            const session = store.create({
                cwd: "/tmp/rig-internal-crash-continuation",
                modelId: model.id,
                permissionMode: "full_access",
                providerId: "claude",
            });
            const submitted = session.submit({ text: "Recover this response." });
            await waitForInferenceRequests(requests, 2);

            expect(session.state().contextMessages?.slice(-2)).toMatchObject([
                {
                    role: "agent",
                    blocks: [{ type: "text", text: "DURABLE_PARTIAL" }],
                },
                {
                    role: "user",
                    internal: true,
                    blocks: [{ type: "text", text: "Continue after the inference crash." }],
                },
            ]);
            expect(JSON.stringify(session.snapshot().snapshot)).not.toContain(
                "Continue after the inference crash.",
            );

            releaseContinuation(
                new Response(
                    JSON.stringify({ content: [{ text: "DURABLE_RECOVERED", type: "text" }] }),
                    { headers: { "content-type": "application/json" }, status: 200 },
                ),
            );
            await expect(session.waitForRun(submitted.runId)).resolves.toEqual({
                status: "completed",
            });
            store.close();
            store = undefined;

            const restoredStore = new PersistentSessionStore({
                databasePath,
                modelCatalog: catalog,
            });
            try {
                const restored = restoredStore.get(session.id);
                expect(restored?.state().contextMessages).toContainEqual(
                    expect.objectContaining({ internal: true, role: "user" }),
                );
                expect(JSON.stringify(restored?.snapshot().snapshot)).not.toContain(
                    "Continue after the inference crash.",
                );
            } finally {
                restoredStore.close();
            }
        } finally {
            releaseContinuation(
                new Response(JSON.stringify({ content: [] }), {
                    headers: { "content-type": "application/json" },
                    status: 200,
                }),
            );
            store?.close();
            globalThis.fetch = originalFetch;
            if (originalInferenceUrl === undefined) delete process.env.RIG_GYM_INFERENCE_URL;
            else process.env.RIG_GYM_INFERENCE_URL = originalInferenceUrl;
            if (originalOverrides === undefined) delete process.env.RIG_GYM_PROVIDER_OVERRIDES;
            else process.env.RIG_GYM_PROVIDER_OVERRIDES = originalOverrides;
            await cleanup();
        }
    });

    it("persists the permission mode in session details and summaries", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const state = sessionState({ permissionMode: "read_only" });
            store.saveSession(state);
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                expect(restoredStore.get(state.id)?.snapshot().permissionMode).toBe("read_only");
                expect(restoredStore.list().at(0)?.permissionMode).toBe("read_only");
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("persists the selected service tier in session details and summaries", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const state = sessionState({ serviceTier: "fast" });
            store.saveSession(state);
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                expect(restoredStore.get(state.id)?.snapshot()).toMatchObject({
                    serviceTier: "fast",
                    snapshot: { serviceTier: "fast" },
                });
                expect(restoredStore.list().at(0)?.serviceTier).toBe("fast");
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("restores fast inference into the runtime and persists disabling it", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "openai/gym",
            name: "Gym",
            thinkingLevels: ["off"],
        });
        const catalog: ModelCatalog = {
            defaultModelId: model.id,
            defaultProviderId: "gym",
            models: [model],
            providers: [{ providerId: "gym", models: [model], serviceTiers: ["fast"] }],
        };
        const inferenceRequests: GymInferenceRequest[] = [];
        const originalFetch = globalThis.fetch;
        const originalInferenceUrl = process.env.RIG_GYM_INFERENCE_URL;
        let openStore: PersistentSessionStore | undefined;
        try {
            process.env.RIG_GYM_INFERENCE_URL = "http://gym.test/inference";
            globalThis.fetch = async (_input, init) => {
                if (typeof init?.body !== "string") {
                    throw new Error("Expected a serialized gym inference request.");
                }
                inferenceRequests.push(JSON.parse(init.body) as GymInferenceRequest);
                return new Response(
                    JSON.stringify({
                        content: [{ text: "Done.", type: "text" }],
                        stopReason: "stop",
                    }),
                    { headers: { "content-type": "application/json" }, status: 200 },
                );
            };

            openStore = new PersistentSessionStore({ databasePath, modelCatalog: catalog });
            const created = openStore.create({
                cwd: "/tmp/rig-fast-persistence-test",
                modelId: model.id,
                providerId: "gym",
                serviceTier: "fast",
            });
            openStore.saveSession({
                ...created.state(),
                title: "Fast persistence",
                titleStatus: "ready",
            });
            const sessionId = created.id;
            openStore.close();
            openStore = undefined;

            openStore = new PersistentSessionStore({ databasePath, modelCatalog: catalog });
            const fastSession = openStore.get(sessionId);
            expect(fastSession?.snapshot()).toMatchObject({
                serviceTier: "fast",
                snapshot: { serviceTier: "fast" },
            });
            const fastRun = fastSession?.submit({ text: "Use fast inference." });
            expect(fastRun).toBeDefined();
            if (fastRun === undefined || fastSession === undefined) {
                throw new Error("Expected the restored fast session.");
            }
            await expect(fastSession.waitForRun(fastRun.runId)).resolves.toEqual({
                status: "completed",
            });
            await new Promise((resolve) => setImmediate(resolve));
            expect(inferenceRequests).toHaveLength(1);
            expect(inferenceRequests[0]?.options.serviceTier).toBe("fast");

            fastSession.changeServiceTier({});
            expect(fastSession.snapshot().serviceTier).toBeUndefined();
            openStore.close();
            openStore = undefined;

            const disabledDatabase = new DatabaseSync(databasePath);
            try {
                expect(
                    disabledDatabase
                        .prepare("SELECT service_tier FROM sessions WHERE id = ?")
                        .get(sessionId),
                ).toEqual({ service_tier: null });
            } finally {
                disabledDatabase.close();
            }

            openStore = new PersistentSessionStore({ databasePath, modelCatalog: catalog });
            const normalSession = openStore.get(sessionId);
            expect(normalSession?.snapshot().serviceTier).toBeUndefined();
            const normalRun = normalSession?.submit({ text: "Use normal inference." });
            expect(normalRun).toBeDefined();
            if (normalRun === undefined || normalSession === undefined) {
                throw new Error("Expected the restored normal session.");
            }
            await expect(normalSession.waitForRun(normalRun.runId)).resolves.toEqual({
                status: "completed",
            });
            await new Promise((resolve) => setImmediate(resolve));
            expect(inferenceRequests).toHaveLength(2);
            expect(inferenceRequests[1]?.options.serviceTier).toBeUndefined();
        } finally {
            openStore?.close();
            globalThis.fetch = originalFetch;
            if (originalInferenceUrl === undefined) {
                delete process.env.RIG_GYM_INFERENCE_URL;
            } else {
                process.env.RIG_GYM_INFERENCE_URL = originalInferenceUrl;
            }
            await cleanup();
        }
    });

    it("persists goal state across daemon restarts", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const state = sessionState({
                goal: {
                    createdAt: 1_700_000_000_000,
                    objective: "Finish the release",
                    status: "paused",
                    updatedAt: 1_700_000_001_000,
                },
            });
            store.saveSession(state);
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                expect(restoredStore.get(state.id)?.snapshot().goal).toEqual(state.goal);
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("persists completed structured question events without reviving the prompt", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const session = store.create({ cwd: "/tmp/rig-persistent-session-test" });
            const pending = session.requestUserInput({
                requestId: "question-1",
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
            session.answerUserInput("question-1", { answers: { database: ["SQLite"] } });
            await pending;
            const sessionId = session.id;
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const restored = restoredStore.get(sessionId);
                expect(restored?.snapshot().pendingUserInputs).toEqual([]);
                expect(restored?.events.since(undefined)?.map((event) => event.type)).toEqual([
                    "session_created",
                    "user_input_requested",
                    "user_input_resolved",
                ]);
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("persists task state and does not reuse deleted task identifiers", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const session = store.create({ cwd: "/tmp/rig-persistent-session-test" });
            session.createTask({ subject: "First", description: "Do the first task." });
            session.createTask({ subject: "Second", description: "Do the second task." });
            session.updateTask("2", { status: "deleted" });
            const sessionId = session.id;
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const restored = restoredStore.get(sessionId);
                expect(restored?.listTasks()).toEqual([
                    expect.objectContaining({ id: "1", subject: "First" }),
                ]);
                expect(
                    restored?.createTask({
                        subject: "Third",
                        description: "Do the third task.",
                    }).id,
                ).toBe("3");
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("persists a fallback when a restored model is no longer available", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        const availableModel = defineModel({
            id: "openai/available",
            name: "Available model",
            thinkingLevels: ["off", "medium"],
            defaultThinkingLevel: "medium",
        });
        const removedModel = defineModel({
            id: "zai/glm-5",
            name: "Removed model",
            thinkingLevels: ["off", "high", "max"],
            defaultThinkingLevel: "max",
        });
        const availableCatalog: ModelCatalog = {
            defaultModelId: availableModel.id,
            defaultProviderId: "codex",
            models: [availableModel],
            providers: [{ providerId: "codex", models: [availableModel] }],
        };
        try {
            const store = new PersistentSessionStore({
                databasePath,
                modelCatalog: {
                    defaultModelId: availableModel.id,
                    defaultProviderId: "codex",
                    models: [availableModel, removedModel],
                    providers: [
                        { providerId: "codex", models: [availableModel] },
                        { providerId: "bedrock", models: [removedModel] },
                    ],
                },
            });
            const sessionId = store.create({
                cwd: "/tmp/rig-persistent-session-test",
                effort: "max",
                modelId: removedModel.id,
                providerId: "bedrock",
            }).id;
            store.close();

            const restoredStore = new PersistentSessionStore({
                databasePath,
                modelCatalog: availableCatalog,
            });
            try {
                expect(restoredStore.get(sessionId)?.snapshot()).toMatchObject({
                    effort: "medium",
                    modelId: availableModel.id,
                    providerId: "codex",
                });
                expect(
                    restoredStore.list().find((session) => session.id === sessionId),
                ).toMatchObject({
                    effort: "medium",
                    modelId: availableModel.id,
                    providerId: "codex",
                });
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("marks running sessions as interrupted after a restart", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({
                databasePath,
                now: () => 1_700_000_000_000,
            });
            const queuedRun: PersistedQueuedRun = {
                displayText: "queued prompt",
                kind: "user",
                runId: "run-2",
                text: "queued prompt",
                userMessage: textUserMessage("message-2", "queued prompt"),
            };
            store.saveSession(
                sessionState({
                    activeRunId: "run-1",
                    queuedRuns: [queuedRun],
                    status: "running",
                }),
            );
            store.insertQueuedRun("session-1", queuedRun);
            store.close();

            const restoredStore = new PersistentSessionStore({
                databasePath,
                now: () => 1_700_000_000_100,
            });
            try {
                const restored = restoredStore.get("session-1");
                const events = restored?.events.since(undefined) ?? [];

                expect(restored?.snapshot().status).toBe("error");
                expect(restored?.snapshot().interruption).toMatchObject({
                    reason: "crash",
                    runId: "run-1",
                });
                expect(events.filter((event) => event.type === "run_error")).toHaveLength(2);
                expect(events.map((event) => event.type)).toEqual(["run_error", "run_error"]);
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("publishes a repaired child status to its parent after a restart", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            store.saveSession(sessionState());
            store.saveSession(
                sessionState({
                    activeRunId: "child-run-1",
                    agent: {
                        depth: 1,
                        description: "Inspect the crash path",
                        parentSessionId: "session-1",
                        rootSessionId: "session-1",
                        type: "subagent",
                    },
                    agentId: "agent-2",
                    id: "subagent-1",
                    status: "running",
                }),
            );
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const parentEvents = restoredStore.get("session-1")?.events.since(undefined) ?? [];
                const changed = parentEvents.find((event) => event.type === "subagent_changed");

                expect(changed).toMatchObject({
                    data: {
                        subagent: {
                            id: "subagent-1",
                            status: "error",
                        },
                    },
                    type: "subagent_changed",
                });
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("restores a parent metadata boundary with a persisted child without recursion", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            store.saveSession(sessionState());
            store.saveSession(
                sessionState({
                    agent: {
                        depth: 1,
                        description: "Inspect the resume boundary",
                        parentSessionId: "session-1",
                        rootSessionId: "session-1",
                        type: "subagent",
                    },
                    agentId: "agent-2",
                    id: "subagent-1",
                    status: "completed",
                }),
            );
            store.get("session-1")?.markInterrupted({
                interruptedAt: 1_700_000_000_000,
                message: "The parent was interrupted before restart.",
                reason: "shutdown",
                runId: "parent-run-1",
            });
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                expect(restoredStore.get("session-1")?.snapshot()).toMatchObject({
                    id: "session-1",
                    interruption: { runId: "parent-run-1" },
                });
                expect(restoredStore.get("subagent-1")?.agentMetadata()).toMatchObject({
                    parentSessionId: "session-1",
                });
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("reuses a stopped subagent session for model-directed follow-up after restart", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "openai/gym",
            name: "Gym",
            thinkingLevels: ["off"],
        });
        const catalog: ModelCatalog = {
            defaultModelId: model.id,
            defaultProviderId: "gym",
            models: [model],
            providers: [{ models: [model], providerId: "gym" }],
        };
        const requests: GymInferenceRequest[] = [];
        const originalFetch = globalThis.fetch;
        const originalInferenceUrl = process.env.RIG_GYM_INFERENCE_URL;
        let restoredStore: PersistentSessionStore | undefined;
        try {
            const store = new PersistentSessionStore({ databasePath, modelCatalog: catalog });
            store.saveSession(
                sessionState({
                    modelId: model.id,
                    models: [model],
                    providerId: "gym",
                    title: "Parent",
                    titleStatus: "ready",
                }),
            );
            store.saveSession(
                sessionState({
                    agent: {
                        depth: 1,
                        description: "Inspect persisted work",
                        parentSessionId: "session-1",
                        rootSessionId: "session-1",
                        taskName: "persisted_worker",
                        type: "subagent",
                    },
                    agentId: "agent-2",
                    id: "subagent-1",
                    modelId: model.id,
                    models: [model],
                    providerId: "gym",
                    status: "aborted",
                    title: "Persisted worker",
                    titleStatus: "ready",
                }),
            );
            store.upsertMessage("subagent-1", {
                isPartial: false,
                message: textUserMessage("old-task", "Remember the original delegated context."),
                position: 0,
                runId: "old-run",
            });
            store.upsertMessage("subagent-1", {
                isPartial: false,
                message: {
                    blocks: [{ text: "Original work stopped.", type: "text" }],
                    id: "old-response",
                    role: "agent",
                },
                position: 1,
                runId: "old-run",
            });
            store.close();

            process.env.RIG_GYM_INFERENCE_URL = "http://gym.test/inference";
            globalThis.fetch = async (_input, init) => {
                if (typeof init?.body !== "string") throw new Error("Expected request JSON.");
                const request = JSON.parse(init.body) as GymInferenceRequest;
                requests.push(request);
                const userTexts = request.context.messages.flatMap((message) =>
                    message.role === "user" ? [providerMessageText(message.content)] : [],
                );
                const lastMessage = request.context.messages.at(-1);
                const lastUserText = userTexts.at(-1) ?? "";
                const response = lastUserText.includes("<subagent-notification>")
                    ? { content: [{ text: "PERSISTED_CHILD_REPORTED", type: "text" }] }
                    : userTexts.includes("Continue the persisted investigation.")
                      ? { content: [{ text: "PERSISTED_CHILD_REUSED", type: "text" }] }
                      : lastMessage?.role === "toolResult" &&
                          lastMessage.toolName === "followup_task"
                        ? { content: [{ text: "FOLLOWUP_ACCEPTED", type: "text" }] }
                        : {
                              content: [
                                  {
                                      arguments: {
                                          message: "Continue the persisted investigation.",
                                          target: "persisted_worker",
                                      },
                                      id: "follow-up-persisted-worker",
                                      name: "followup_task",
                                      type: "toolCall",
                                  },
                              ],
                          };
                return new Response(JSON.stringify(response), {
                    headers: { "content-type": "application/json" },
                    status: 200,
                });
            };

            const taskDrain = new TrackedTaskDrain();
            restoredStore = new PersistentSessionStore({
                databasePath,
                modelCatalog: catalog,
                taskDrain,
            });
            const parent = restoredStore.get("session-1");
            if (parent === undefined) throw new Error("Expected the restored parent session.");
            const submitted = parent.submit({ text: "Ask the old worker to continue." });
            await expect(parent.waitForRun(submitted.runId)).resolves.toEqual({
                status: "completed",
            });

            const child = restoredStore.get("subagent-1");
            if (child === undefined) throw new Error("Expected the restored child session.");
            const followUpEvent = child.events
                .since(undefined)
                ?.find(
                    (event): event is Extract<SessionEvent, { type: "message_submitted" }> =>
                        event.type === "message_submitted" &&
                        event.data.displayText === "Continue the persisted investigation.",
                );
            const followUpRunId = followUpEvent?.data.runId;
            if (followUpRunId === undefined) throw new Error("Expected the child follow-up run.");
            await expect(child.waitForRun(followUpRunId)).resolves.toEqual({
                status: "completed",
            });
            expect(
                requests.some((request) => {
                    const texts = request.context.messages.flatMap((message) =>
                        message.role === "user" ? [providerMessageText(message.content)] : [],
                    );
                    return (
                        texts.includes("Remember the original delegated context.") &&
                        texts.includes("Continue the persisted investigation.")
                    );
                }),
            ).toBe(true);
            await restoredStore.prepareForShutdown("shutdown");
            restoredStore.close();
            restoredStore = undefined;
        } finally {
            globalThis.fetch = originalFetch;
            if (originalInferenceUrl === undefined) delete process.env.RIG_GYM_INFERENCE_URL;
            else process.env.RIG_GYM_INFERENCE_URL = originalInferenceUrl;
            restoredStore?.close();
            await cleanup();
        }
    });

    it("updates partial messages in place while streaming", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const state = sessionState({ status: "running" });
            store.saveSession(state);
            store.upsertMessage(state.id, {
                isPartial: true,
                message: {
                    blocks: [{ text: "hel", type: "text" }],
                    id: "assistant-1",
                    role: "agent",
                },
                position: 0,
                runId: "run-1",
            });
            store.upsertMessage(state.id, {
                isPartial: true,
                message: {
                    blocks: [{ text: "hello", type: "text" }],
                    id: "assistant-1",
                    role: "agent",
                },
                position: 0,
                runId: "run-1",
            });
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const restored = restoredStore.get(state.id);

                expect(restored?.state().messages).toEqual([
                    {
                        isPartial: true,
                        message: {
                            blocks: [{ text: "hello", type: "text" }],
                            id: "assistant-1",
                            role: "agent",
                        },
                        position: 0,
                        runId: "run-1",
                    },
                ]);
                expect(restored?.snapshot().snapshot.messages).toEqual([]);
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("emits terminal events for accepted queued runs that are aborted before start", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const queuedRun: PersistedQueuedRun = {
                displayText: "queued prompt",
                kind: "user",
                runId: "run-1",
                text: "queued prompt",
                userMessage: textUserMessage("message-1", "queued prompt"),
            };
            store.saveSession(
                sessionState({
                    queuedRuns: [queuedRun],
                    status: "queued",
                }),
            );
            store.insertQueuedRun("session-1", queuedRun);

            const session = store.get("session-1");
            const response = await session?.abort();
            const events = session?.events.since(undefined) ?? [];

            expect(response?.aborted).toBe(true);
            expect(events.map((event) => event.type)).toEqual(["abort_requested", "run_error"]);
            expect(events.at(-1)).toMatchObject({
                data: { runId: "run-1" },
                type: "run_error",
            });
            store.close();
        } finally {
            await cleanup();
        }
    });

    it("lists sessions by most recent submitted message", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            store.saveSession(
                sessionState({
                    id: "older-session",
                    lastMessageAt: 1_700_000_000_000,
                    title: "Older Work",
                    titleStatus: "ready",
                }),
            );
            store.saveSession(
                sessionState({
                    id: "newer-session",
                    lastMessageAt: 1_700_000_001_000,
                    title: "Newer Work",
                    titleStatus: "ready",
                }),
            );

            const sessions = store.list({ limit: 1 });

            expect(sessions).toEqual([
                expect.objectContaining({
                    id: "newer-session",
                    title: "Newer Work",
                }),
            ]);
            store.close();
        } finally {
            await cleanup();
        }
    });

    it("persists settled session metadata", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            store.saveSession(
                sessionState({
                    title: "Persisted Title",
                    titleStatus: "ready",
                    recap: "The persisted recap remains available after restart.",
                    metadataRunId: "run-1",
                    metadataUpdatedAt: 1_700_000_002_000,
                }),
            );
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const restored = restoredStore.get("session-1");
                const summary = restoredStore.list({ limit: 1 }).at(0);

                expect(restored?.snapshot()).toMatchObject({
                    title: "Persisted Title",
                    titleStatus: "ready",
                    recap: "The persisted recap remains available after restart.",
                    metadataRunId: "run-1",
                    metadataUpdatedAt: 1_700_000_002_000,
                });
                expect(summary).toMatchObject({
                    title: "Persisted Title",
                    titleStatus: "ready",
                    recap: "The persisted recap remains available after restart.",
                    metadataRunId: "run-1",
                    metadataUpdatedAt: 1_700_000_002_000,
                });
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("changes models after restoring an existing conversation", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        const catalog = testModelCatalog();
        try {
            const store = new PersistentSessionStore({ databasePath, modelCatalog: catalog });
            const userMessage = textUserMessage("message-1", "started");
            const state = sessionState({
                effort: "low",
                messages: [
                    {
                        isPartial: false,
                        message: userMessage,
                        position: 0,
                        runId: "run-1",
                    },
                ],
                modelId: "openai/test",
                models: catalog.models,
            });
            store.saveSession(state);
            const entry = state.messages[0];
            expect(entry).toBeDefined();
            if (entry !== undefined) {
                store.upsertMessage(state.id, entry);
            }
            store.close();

            const restoredStore = new PersistentSessionStore({
                databasePath,
                modelCatalog: catalog,
            });
            try {
                const restored = restoredStore.get(state.id);

                expect(restored?.snapshot().modelLocked).toBe(false);
                restored?.changeModel({ effort: "high", modelId: "anthropic/test" });

                const snapshot = restored?.snapshot();
                const events = restored?.events.since(undefined) ?? [];
                expect(snapshot).toMatchObject({
                    effort: "high",
                    modelId: "anthropic/test",
                    modelLocked: false,
                    providerId: "claude",
                });
                expect(events.at(-1)).toMatchObject({
                    data: {
                        effort: "high",
                        modelId: "anthropic/test",
                    },
                    type: "model_changed",
                });
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("persists a forked conversation under a new session", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const source = store.create({ cwd: "/tmp/rig-persistent-session-test" });
            const state = source.state();
            const message = textUserMessage("message-1", "Preserve this conversation.");
            store.upsertMessage(source.id, {
                isPartial: false,
                message,
                position: 0,
                runId: "run-1",
            });
            store.close();

            const forkStore = new PersistentSessionStore({ databasePath });
            const forked = forkStore.fork(state.id);
            expect(forked?.id).not.toBe(state.id);
            expect(forked?.snapshot().snapshot.messages).toEqual([message]);
            const forkedId = forked?.id;
            forkStore.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                expect(forkedId).toBeDefined();
                expect(restoredStore.get(forkedId ?? "")?.snapshot().snapshot.messages).toEqual([
                    message,
                ]);
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("repairs interrupted title generation on restart", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            store.saveSession(
                sessionState({
                    titleStatus: "generating",
                }),
            );
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const summary = restoredStore.list({ limit: 1 }).at(0);

                expect(summary).toMatchObject({
                    titleStatus: "error",
                });
                expect(summary?.titleError).toContain("interrupted");
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("persists subagent lineage while keeping child histories out of the main list", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            store.saveSession(sessionState());
            store.saveSession(
                sessionState({
                    agent: {
                        depth: 1,
                        description: "Inspect the persistence layer",
                        parentSessionId: "session-1",
                        parentToolCallId: "tool-1",
                        rootSessionId: "session-1",
                        taskName: "inspect_persistence",
                        type: "subagent",
                    },
                    agentId: "agent-2",
                    activeSince: 1_500,
                    elapsedMs: 2_500,
                    id: "subagent-1",
                    status: "completed",
                    title: "Inspect the persistence layer",
                    titleStatus: "ready",
                    totalTokens: 12_345,
                }),
            );
            store.saveSession(
                sessionState({
                    agent: {
                        depth: 2,
                        description: "Inspect the nested query",
                        parentSessionId: "subagent-1",
                        rootSessionId: "session-1",
                        taskName: "inspect_nested_query",
                        type: "subagent",
                    },
                    agentId: "agent-3",
                    elapsedMs: 900,
                    id: "subagent-2",
                    status: "error",
                    totalTokens: 600,
                }),
            );
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                expect(restoredStore.list().map((session) => session.id)).toEqual(["session-1"]);
                expect(restoredStore.listSubagents("session-1")).toEqual([
                    expect.objectContaining({
                        activeSince: 1_500,
                        depth: 1,
                        description: "Inspect the persistence layer",
                        elapsedMs: 2_500,
                        id: "subagent-1",
                        parentToolCallId: "tool-1",
                        status: "completed",
                        taskName: "inspect_persistence",
                        totalTokens: 12_345,
                    }),
                    expect.objectContaining({
                        depth: 2,
                        elapsedMs: 900,
                        id: "subagent-2",
                        parentSessionId: "subagent-1",
                        status: "error",
                        totalTokens: 600,
                    }),
                ]);
                expect(restoredStore.listSubagents("subagent-1")).toEqual([
                    expect.objectContaining({ id: "subagent-2" }),
                ]);
                expect(restoredStore.get("subagent-1")?.snapshot().agent).toEqual({
                    depth: 1,
                    description: "Inspect the persistence layer",
                    parentSessionId: "session-1",
                    parentToolCallId: "tool-1",
                    rootSessionId: "session-1",
                    taskName: "inspect_persistence",
                    type: "subagent",
                });
                expect(() =>
                    restoredStore.get("subagent-1")?.requestUserInput({
                        requestId: "question-1",
                        questions: [],
                    }),
                ).toThrow("Only the primary session");
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });
});

async function waitForExternalToolCall(session: InMemorySession) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const call = session.externalToolCalls({ status: "pending" })[0];
        if (call !== undefined) return call;
        await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error("Timed out waiting for the external function call.");
}

async function waitForPendingUserInputs(session: InMemorySession, count: number) {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
        const requests = session.snapshot().pendingUserInputs;
        if (requests.length === count) return requests;
        await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error("Timed out waiting for the durable user question.");
}

async function waitForInferenceRequests(
    requests: readonly GymInferenceRequest[],
    count: number,
): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        if (requests.length >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Timed out waiting for inference requests.");
}

async function createDatabasePath(): Promise<{
    cleanup: () => Promise<void>;
    databasePath: string;
}> {
    const directory = await mkdtemp(join(tmpdir(), "rig-sessions-test-"));
    return {
        cleanup: () => rm(directory, { force: true, recursive: true }),
        databasePath: join(directory, "sessions.sqlite"),
    };
}

function testModelCatalog(): ModelCatalog {
    const openai = defineModel({
        id: "openai/test",
        name: "OpenAI Test",
        thinkingLevels: ["low", "high"],
        defaultThinkingLevel: "low",
    });
    const anthropic = defineModel({
        id: "anthropic/test",
        name: "Anthropic Test",
        thinkingLevels: ["low", "high"],
        defaultThinkingLevel: "low",
    });
    return {
        defaultModelId: openai.id,
        defaultProviderId: "codex",
        models: [openai, anthropic],
        providers: [
            { providerId: "codex", models: [openai] },
            { providerId: "claude", models: [anthropic] },
        ],
    };
}

function sessionState(overrides: Partial<PersistedSessionState> = {}): PersistedSessionState {
    return {
        agent: {
            depth: 0,
            rootSessionId: "session-1",
            type: "primary",
        },
        agentId: "agent-1",
        cwd: "/tmp/rig-persistent-session-test",
        id: "session-1",
        messages: [],
        modelId: "openai/gpt-5.5",
        models: [],
        providerId: "codex",
        permissionMode: "workspace_write",
        queuedRuns: [],
        nextTaskId: 1,
        status: "idle",
        tasks: [],
        titleStatus: "idle",
        tools: [],
        ...overrides,
    };
}

function textUserMessage(id: string, text: string): UserMessage {
    return {
        blocks: [{ text, type: "text" }],
        id,
        role: "user",
    };
}

function providerMessageText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .flatMap((block) =>
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            block.type === "text" &&
            "text" in block &&
            typeof block.text === "string"
                ? [block.text]
                : [],
        )
        .join("\n");
}

function sessionEvent(
    sessionId: string,
    id: string,
    type: SessionEvent["type"],
    data: unknown,
): SessionEvent {
    return {
        createdAt: 1_700_000_000_000,
        data,
        id,
        sessionId,
        type,
    } as SessionEvent;
}

function insertSessionEvent(
    database: DatabaseSync,
    sessionId: string,
    id: string,
    type: SessionEvent["type"],
    data: unknown,
): void {
    database
        .prepare(
            `
            INSERT INTO session_events (session_id, event_id, type, created_at_ms, data_json)
            VALUES (?, ?, ?, ?, ?)
            `,
        )
        .run(sessionId, id, type, 1_700_000_000_000, JSON.stringify(data));
}

function insertEvent<TType extends import("../protocol/index.js").SessionEvent["type"]>(
    database: DatabaseSync,
    sessionId: string,
    eventId: string,
    type: TType,
    createdAt: number,
    data: Extract<import("../protocol/index.js").SessionEvent, { type: TType }>["data"],
): void {
    database
        .prepare(
            "INSERT INTO session_events (session_id, event_id, type, created_at_ms, data_json) VALUES (?, ?, ?, ?, ?)",
        )
        .run(sessionId, eventId, type, createdAt, JSON.stringify(data));
}
