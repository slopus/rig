import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { UserMessage } from "../agent/types.js";
import type { ModelCatalog } from "../protocol/index.js";
import type { GymInferenceRequest } from "../providers/gym-types.js";
import { defineModel } from "../providers/types.js";
import type { PersistedQueuedRun, PersistedSessionState } from "./InMemorySession.js";
import { PersistentSessionStore } from "./PersistentSessionStore.js";

describe("PersistentSessionStore", () => {
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

    it("migrates legacy session databases without a service tier column", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        const catalog = testModelCatalog();
        try {
            const store = new PersistentSessionStore({ databasePath, modelCatalog: catalog });
            const state = sessionState({
                modelId: catalog.defaultModelId,
                models: catalog.models,
                title: "Legacy session",
                titleStatus: "ready",
            });
            store.saveSession(state);
            store.close();

            const legacyDatabase = new DatabaseSync(databasePath);
            try {
                legacyDatabase.exec("ALTER TABLE sessions DROP COLUMN service_tier");
                expect(
                    legacyDatabase
                        .prepare("PRAGMA table_info(sessions)")
                        .all()
                        .some((column) => column.name === "service_tier"),
                ).toBe(false);
            } finally {
                legacyDatabase.close();
            }

            const restoredStore = new PersistentSessionStore({
                databasePath,
                modelCatalog: catalog,
            });
            try {
                expect(restoredStore.get(state.id)?.snapshot()).toMatchObject({
                    cwd: state.cwd,
                    id: state.id,
                    modelId: state.modelId,
                    providerId: state.providerId,
                    title: "Legacy session",
                });

                const migratedDatabase = new DatabaseSync(databasePath);
                try {
                    const serviceTierColumn = migratedDatabase
                        .prepare("PRAGMA table_info(sessions)")
                        .all()
                        .find((column) => column.name === "service_tier");
                    expect(serviceTierColumn).toMatchObject({
                        name: "service_tier",
                        notnull: 0,
                        type: "TEXT",
                    });
                    expect(
                        migratedDatabase
                            .prepare("SELECT service_tier FROM sessions WHERE id = ?")
                            .get(state.id),
                    ).toEqual({ service_tier: null });
                } finally {
                    migratedDatabase.close();
                }
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
                    providerId: "claude-sdk",
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
                    id: "subagent-1",
                    status: "completed",
                    title: "Inspect the persistence layer",
                    titleStatus: "ready",
                }),
            );
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                expect(restoredStore.list().map((session) => session.id)).toEqual(["session-1"]);
                expect(restoredStore.listSubagents("session-1")).toEqual([
                    expect.objectContaining({
                        depth: 1,
                        description: "Inspect the persistence layer",
                        id: "subagent-1",
                        parentToolCallId: "tool-1",
                        status: "completed",
                        taskName: "inspect_persistence",
                    }),
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
            { providerId: "claude-sdk", models: [anthropic] },
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
