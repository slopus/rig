import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { UserMessage } from "../agent/types.js";
import {
    createEventIdFactory,
    eventIdsShareScope,
    type ModelCatalog,
    type SessionEvent,
} from "../protocol/index.js";
import type { GymInferenceRequest } from "../providers/gym-types.js";
import { defineModel } from "../providers/types.js";
import type { PersistedQueuedRun, PersistedSessionState } from "./InMemorySession.js";
import { PersistentSessionStore } from "./PersistentSessionStore.js";

describe("PersistentSessionStore", () => {
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

    it("skips legacy transient rows on restore while retaining durable event ordering", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const sessionId = store.create({ cwd: "/tmp/rig-persistent-session-test" }).id;
            store.close();

            const database = new DatabaseSync(databasePath);
            insertSessionEvent(database, sessionId, "run-started", "run_started", {
                runId: "run-1",
            });
            insertSessionEvent(database, sessionId, "legacy-delta", "agent_event", {
                event: { contentIndex: 0, delta: "legacy", partial: {}, type: "text_delta" },
                runId: "run-1",
            });
            insertSessionEvent(database, sessionId, "tool-started", "agent_event", {
                event: {
                    toolCall: {
                        arguments: { cmd: "true" },
                        id: "tool-1",
                        name: "exec_command",
                        type: "toolCall",
                    },
                    type: "tool_execution_start",
                },
                runId: "run-1",
            });
            insertSessionEvent(database, sessionId, "process-changed", "agent_event", {
                event: { running: 1, type: "background_processes_changed" },
                runId: "run-1",
            });
            insertSessionEvent(database, sessionId, "compacted", "agent_event", {
                event: {
                    compactedMessageCount: 3,
                    estimatedTokensAfter: 500,
                    estimatedTokensBefore: 2_000,
                    reason: "threshold",
                    type: "context_compacted",
                },
                runId: "run-1",
            });
            insertSessionEvent(database, sessionId, "run-finished", "run_finished", {
                modelLocked: true,
                runId: "run-1",
                stopReason: "stop",
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
                    "run-started",
                    "tool-started",
                    "process-changed",
                    "compacted",
                    "run-finished",
                ]);
            } finally {
                restoredStore.close();
            }

            const retainedDatabase = new DatabaseSync(databasePath, { readOnly: true });
            try {
                expect(
                    retainedDatabase
                        .prepare("SELECT COUNT(*) AS count FROM session_events WHERE event_id = ?")
                        .get("legacy-delta"),
                ).toEqual({ count: 1 });
            } finally {
                retainedDatabase.close();
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

    it("atomically repairs terminal legacy user steering once with event and context identity", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const alreadyStored = textUserMessage("already-stored", "already stored");
            const alreadyApplied = textUserMessage("already-applied", "already applied");
            const orphaned = textUserMessage("legacy-orphan", "repair me");
            const richOrphanedContext = textUserMessage(
                orphaned.id,
                "richer compacted context for repair me",
            );
            const secondOrphaned = textUserMessage("second-legacy-orphan", "repair me second");
            const notification = textUserMessage("legacy-notification", "background display text");
            const state = sessionState({
                contextMessages: [alreadyStored, alreadyApplied, richOrphanedContext],
                modelId: "openai/test",
                models: testModelCatalog().models,
                providerId: "codex",
                status: "aborted",
            });
            const store = new PersistentSessionStore({
                databasePath,
                durableGlobalEventQueue: true,
                modelCatalog: testModelCatalog(),
            });
            store.saveSession(state);
            store.upsertMessage(state.id, {
                isPartial: false,
                message: alreadyStored,
                position: 0,
                runId: "legacy-run",
            });
            store.upsertMessage(state.id, {
                isPartial: false,
                message: alreadyApplied,
                position: 1,
                runId: "legacy-run",
            });
            store.close();

            const database = new DatabaseSync(databasePath);
            insertEvent(database, state.id, "started-legacy-run", "run_started", 1, {
                runId: "legacy-run",
            });
            insertEvent(database, state.id, "submitted-orphan", "message_submitted", 2, {
                delivery: "steer",
                displayText: "repair me",
                message: orphaned,
                runId: "legacy-run",
            });
            insertEvent(database, state.id, "submitted-stored", "message_submitted", 3, {
                delivery: "steer",
                displayText: "already stored",
                message: alreadyStored,
                runId: "legacy-run",
            });
            insertEvent(database, state.id, "submitted-second", "message_submitted", 4, {
                delivery: "steer",
                displayText: "repair me second",
                message: secondOrphaned,
                runId: "legacy-run",
            });
            insertEvent(database, state.id, "submitted-applied", "message_submitted", 5, {
                delivery: "steer",
                displayText: "already applied",
                message: alreadyApplied,
                runId: "legacy-run",
            });
            insertEvent(database, state.id, "applied-modern", "steering_applied", 6, {
                messageIds: [alreadyApplied.id],
                runId: "legacy-run",
            });
            insertEvent(database, state.id, "submitted-notification", "message_submitted", 7, {
                delivery: "steer",
                displayText: "Background work completed.",
                message: notification,
                runId: "legacy-run",
                source: "notification",
            });
            insertEvent(database, state.id, "finished-legacy-run", "run_finished", 8, {
                agentRunId: "legacy-agent-run",
                modelLocked: true,
                runId: "legacy-run",
                stopReason: "aborted",
            });
            database.close();

            const restoredStore = new PersistentSessionStore({
                databasePath,
                durableGlobalEventQueue: true,
                modelCatalog: testModelCatalog(),
                now: () => 200,
            });
            try {
                const restored = restoredStore.get(state.id);
                expect(restored?.snapshot().snapshot.messages.map((message) => message.id)).toEqual(
                    [orphaned.id, alreadyStored.id, secondOrphaned.id, alreadyApplied.id],
                );
                expect(restored?.snapshot().snapshot.contextMessages).toEqual([
                    richOrphanedContext,
                    alreadyStored,
                    secondOrphaned,
                    alreadyApplied,
                ]);
                const events = restored?.events.since(undefined) ?? [];
                const repairEvents = events.filter(
                    (event) =>
                        event.type === "steering_applied" &&
                        event.data.messageIds.includes(orphaned.id),
                );
                expect(repairEvents).toHaveLength(1);
                expect(repairEvents[0]).toMatchObject({
                    data: {
                        messageIds: [orphaned.id, alreadyStored.id, secondOrphaned.id],
                        runId: "legacy-run",
                    },
                    type: "steering_applied",
                });
                expect(
                    restored
                        ?.snapshot()
                        .snapshot.messages.some((message) => message.id === notification.id),
                ).toBe(false);
                expect(
                    events.some(
                        (event) =>
                            event.type === "steering_applied" &&
                            event.data.messageIds.includes(notification.id),
                    ),
                ).toBe(false);
                expect(restoredStore.globalEventQueue?.list()).toEqual([
                    expect.objectContaining({
                        cursor: 1,
                        event: expect.objectContaining({ id: repairEvents[0]?.id }),
                    }),
                ]);
            } finally {
                restoredStore.close();
            }

            const afterFirstOpen = readLegacyRepairDatabaseState(databasePath, state.id);
            expect(afterFirstOpen.lastEventId).toBe(afterFirstOpen.repairEventId);
            expect(afterFirstOpen.globalLastCursor).toBe(1);
            expect(afterFirstOpen.messageIds).toEqual([
                orphaned.id,
                alreadyStored.id,
                secondOrphaned.id,
                alreadyApplied.id,
            ]);

            const reopenedStore = new PersistentSessionStore({
                databasePath,
                durableGlobalEventQueue: true,
                modelCatalog: testModelCatalog(),
                now: () => 300,
            });
            reopenedStore.close();
            expect(readLegacyRepairDatabaseState(databasePath, state.id)).toEqual(afterFirstOpen);
        } finally {
            await cleanup();
        }
    });

    it("repairs legacy steering with each restored session's cursor scope", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const sessions = [
                store.create({ cwd: "/tmp/rig-repair-scope-a" }),
                store.create({ cwd: "/tmp/rig-repair-scope-b" }),
            ];
            const initialIds = sessions.map((session) => session.snapshot().lastEventId);
            store.close();
            if (initialIds.some((id) => id === undefined)) {
                throw new Error("Expected initial session event identifiers.");
            }

            const database = new DatabaseSync(databasePath);
            for (const [index, session] of sessions.entries()) {
                const initialId = initialIds[index];
                if (initialId === undefined) continue;
                const createEventId = createEventIdFactory({ after: initialId });
                const runId = `legacy-run-${String(index)}`;
                const message = textUserMessage(`legacy-message-${String(index)}`, "repair me");
                insertEvent(database, session.id, createEventId(), "run_started", 2, { runId });
                insertEvent(database, session.id, createEventId(), "message_submitted", 3, {
                    delivery: "steer",
                    displayText: "repair me",
                    message,
                    runId,
                });
                insertEvent(database, session.id, createEventId(), "run_finished", 4, {
                    agentRunId: `agent-run-${String(index)}`,
                    modelLocked: true,
                    runId,
                    stopReason: "aborted",
                });
            }
            database.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const repairedIds = sessions.map(
                    (session) =>
                        restoredStore
                            .get(session.id)
                            ?.events.since(undefined)
                            ?.find((event) => event.type === "steering_applied")?.id,
                );
                expect(repairedIds.every((id) => id !== undefined)).toBe(true);
                expect(eventIdsShareScope(initialIds[0]!, repairedIds[0]!)).toBe(true);
                expect(eventIdsShareScope(initialIds[1]!, repairedIds[1]!)).toBe(true);
                expect(eventIdsShareScope(repairedIds[0]!, repairedIds[1]!)).toBe(false);
                expect(
                    restoredStore.get(sessions[0]!.id)?.events.since(repairedIds[1]!),
                ).toBeUndefined();
                expect(
                    restoredStore.get(sessions[1]!.id)?.events.since(repairedIds[0]!),
                ).toBeUndefined();
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("sends repaired run A steering before later stored run B on the next inference", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "openai/gym",
            name: "Gym order",
            thinkingLevels: ["off"],
        });
        const catalog: ModelCatalog = {
            defaultModelId: model.id,
            defaultProviderId: "gym",
            models: [model],
            providers: [{ providerId: "gym", models: [model] }],
        };
        const runA = textUserMessage("run-a-message", "Run A request");
        const orphan = textUserMessage("run-a-orphan", "Run A repaired steering");
        const runB = textUserMessage("run-b-message", "Run B later request");
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
                        content: [{ text: "Ordered.", type: "text" }],
                        stopReason: "stop",
                    }),
                    { headers: { "content-type": "application/json" }, status: 200 },
                );
            };

            openStore = new PersistentSessionStore({ databasePath, modelCatalog: catalog });
            const state = sessionState({
                contextMessages: [runA, runB],
                modelId: model.id,
                models: [model],
                providerId: "gym",
                status: "completed",
                title: "Ordering test",
                titleStatus: "ready",
            });
            openStore.saveSession(state);
            openStore.upsertMessage(state.id, {
                isPartial: false,
                message: runA,
                position: 0,
                runId: "run-a",
            });
            openStore.upsertMessage(state.id, {
                isPartial: false,
                message: runB,
                position: 1,
                runId: "run-b",
            });
            openStore.close();
            openStore = undefined;

            const database = new DatabaseSync(databasePath);
            insertEvent(database, state.id, "run-a-start", "run_started", 1, {
                runId: "run-a",
            });
            insertEvent(database, state.id, "run-a-submitted", "message_submitted", 2, {
                delivery: "run",
                displayText: "Run A request",
                message: runA,
                runId: "run-a",
            });
            insertEvent(database, state.id, "run-a-steering", "message_submitted", 3, {
                delivery: "steer",
                displayText: "Run A repaired steering",
                message: orphan,
                runId: "run-a",
            });
            insertEvent(database, state.id, "run-a-finished", "run_finished", 4, {
                agentRunId: "agent-run-a",
                modelLocked: true,
                runId: "run-a",
                stopReason: "aborted",
            });
            insertEvent(database, state.id, "run-b-start", "run_started", 5, {
                runId: "run-b",
            });
            insertEvent(database, state.id, "run-b-submitted", "message_submitted", 6, {
                delivery: "run",
                displayText: "Run B later request",
                message: runB,
                runId: "run-b",
            });
            insertEvent(database, state.id, "run-b-finished", "run_finished", 7, {
                agentRunId: "agent-run-b",
                modelLocked: false,
                runId: "run-b",
                stopReason: "stop",
            });
            database.close();

            openStore = new PersistentSessionStore({ databasePath, modelCatalog: catalog });
            const restored = openStore.get(state.id);
            expect(restored?.snapshot().snapshot.messages.map((message) => message.id)).toEqual([
                runA.id,
                orphan.id,
                runB.id,
            ]);
            expect(
                restored?.snapshot().snapshot.contextMessages?.map((message) => message.id),
            ).toEqual([runA.id, orphan.id, runB.id]);
            if (restored === undefined) throw new Error("Expected the repaired session.");
            const submitted = restored.submit({ text: "Fresh request" });
            await expect(restored.waitForRun(submitted.runId)).resolves.toEqual({
                status: "completed",
            });

            expect(inferenceRequests).toHaveLength(1);
            expect(
                inferenceRequests[0]?.context.messages.flatMap((message) => {
                    if (message.role !== "user") return [];
                    if (typeof message.content === "string") return [message.content];
                    return [
                        message.content
                            .flatMap((block) => (block.type === "text" ? [block.text] : []))
                            .join(""),
                    ];
                }),
            ).toEqual([
                "Run A request",
                "Run A repaired steering",
                "Run B later request",
                "Fresh request",
            ]);
        } finally {
            openStore?.close();
            globalThis.fetch = originalFetch;
            if (originalInferenceUrl === undefined) delete process.env.RIG_GYM_INFERENCE_URL;
            else process.env.RIG_GYM_INFERENCE_URL = originalInferenceUrl;
            await cleanup();
        }
    });

    it("leaves notifications, modern runs, invalid ordering, and discarded epochs unchanged", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const state = sessionState({
                modelId: "openai/test",
                models: testModelCatalog().models,
                providerId: "codex",
                status: "completed",
            });
            const store = new PersistentSessionStore({
                databasePath,
                durableGlobalEventQueue: true,
                modelCatalog: testModelCatalog(),
            });
            store.saveSession(state);
            store.close();

            const database = new DatabaseSync(databasePath);
            const modern = textUserMessage("modern", "modern applied steering");
            const notification = textUserMessage("notification", "background display text");
            const terminalFirst = textUserMessage("terminal-first", "submitted too late");
            const missingStart = textUserMessage("missing-start", "no run start");
            const beforeReset = textUserMessage("before-reset", "discarded by reset");
            const wrongTerminal = textUserMessage("wrong-terminal", "different terminal run");
            insertEvent(database, state.id, "modern-start", "run_started", 1, {
                runId: "modern-run",
            });
            insertEvent(database, state.id, "modern-submit", "message_submitted", 2, {
                delivery: "steer",
                displayText: "modern applied steering",
                message: modern,
                runId: "modern-run",
            });
            insertEvent(database, state.id, "modern-applied", "steering_applied", 3, {
                messageIds: [modern.id],
                runId: "modern-run",
            });
            insertEvent(database, state.id, "modern-finished", "run_finished", 4, {
                agentRunId: "modern-agent-run",
                modelLocked: true,
                runId: "modern-run",
                stopReason: "stop",
            });
            insertEvent(database, state.id, "notification-start", "run_started", 5, {
                runId: "notification-run",
            });
            insertEvent(database, state.id, "notification-submit", "message_submitted", 6, {
                delivery: "steer",
                displayText: "Background work completed.",
                message: notification,
                runId: "notification-run",
                source: "notification",
            });
            insertEvent(database, state.id, "notification-finished", "run_finished", 7, {
                agentRunId: "notification-agent-run",
                modelLocked: true,
                runId: "notification-run",
                stopReason: "stop",
            });
            insertEvent(database, state.id, "terminal-first-start", "run_started", 8, {
                runId: "terminal-first-run",
            });
            insertEvent(database, state.id, "terminal-first-finished", "run_finished", 9, {
                agentRunId: "terminal-first-agent-run",
                modelLocked: true,
                runId: "terminal-first-run",
                stopReason: "stop",
            });
            insertEvent(database, state.id, "terminal-first-submit", "message_submitted", 10, {
                delivery: "steer",
                displayText: "submitted too late",
                message: terminalFirst,
                runId: "terminal-first-run",
            });
            insertEvent(database, state.id, "missing-start-submit", "message_submitted", 11, {
                delivery: "steer",
                displayText: "no run start",
                message: missingStart,
                runId: "missing-start-run",
            });
            insertEvent(database, state.id, "missing-start-finished", "run_finished", 12, {
                agentRunId: "missing-start-agent-run",
                modelLocked: true,
                runId: "missing-start-run",
                stopReason: "stop",
            });
            insertEvent(database, state.id, "reset-start", "run_started", 13, {
                runId: "reset-run",
            });
            insertEvent(database, state.id, "reset-submit", "message_submitted", 14, {
                delivery: "steer",
                displayText: "discarded by reset",
                message: beforeReset,
                runId: "reset-run",
            });
            insertEvent(database, state.id, "reset-finished", "run_finished", 15, {
                agentRunId: "reset-agent-run",
                modelLocked: true,
                runId: "reset-run",
                stopReason: "stop",
            });
            insertEvent(database, state.id, "session-reset", "session_reset", 16, {
                snapshot: emptyAgentSnapshot(),
            });
            insertEvent(database, state.id, "wrong-terminal-start", "run_started", 17, {
                runId: "wrong-terminal-run",
            });
            insertEvent(database, state.id, "wrong-terminal-submit", "message_submitted", 18, {
                delivery: "steer",
                displayText: "different terminal run",
                message: wrongTerminal,
                runId: "wrong-terminal-run",
            });
            insertEvent(database, state.id, "other-run-finished", "run_finished", 19, {
                agentRunId: "other-agent-run",
                modelLocked: true,
                runId: "other-run",
                stopReason: "stop",
            });
            const before = readSessionPersistenceCounts(database, state.id);
            database.close();

            const restored = new PersistentSessionStore({
                databasePath,
                durableGlobalEventQueue: true,
                modelCatalog: testModelCatalog(),
            });
            restored.close();

            const verify = new DatabaseSync(databasePath);
            try {
                expect(readSessionPersistenceCounts(verify, state.id)).toEqual(before);
                expect(
                    verify
                        .prepare(
                            "SELECT COUNT(*) AS count FROM session_events WHERE session_id = ? AND type = 'steering_applied'",
                        )
                        .get(state.id),
                ).toEqual({ count: 1 });
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

    it("does not promote steering terminated by an unmarked legacy restart error", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const active = textUserMessage("legacy-suspended-orphan", "still not user context");
            const store = new PersistentSessionStore({
                databasePath,
                modelCatalog: testModelCatalog(),
            });
            store.saveSession(sessionState());
            const state = sessionState({
                agent: {
                    depth: 1,
                    description: "Legacy suspended worker",
                    parentSessionId: "session-1",
                    rootSessionId: "session-1",
                    type: "subagent",
                },
                agentId: "legacy-subagent-agent",
                id: "legacy-subagent-1",
                status: "suspended",
            });
            store.saveSession(state);
            store.close();
            const database = new DatabaseSync(databasePath);
            insertEvent(database, state.id, "legacy-suspended-start", "run_started", 1, {
                runId: "legacy-suspended-run",
            });
            insertEvent(database, state.id, "legacy-suspended-submit", "message_submitted", 2, {
                delivery: "steer",
                displayText: "still not user context",
                message: active,
                runId: "legacy-suspended-run",
            });
            insertEvent(database, state.id, "legacy-suspended-error", "run_error", 3, {
                errorMessage:
                    "The subagent stopped working because the local server restarted before its suspended run finished.",
                modelLocked: true,
                runId: "legacy-suspended-run",
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
                const normalizedError = verify
                    .prepare(
                        "SELECT data_json FROM session_events WHERE session_id = ? AND event_id = 'legacy-suspended-error'",
                    )
                    .get(state.id) as { data_json: string };
                expect(JSON.parse(normalizedError.data_json)).toEqual(
                    expect.objectContaining({ startupInterruption: true }),
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

function emptyAgentSnapshot(): import("../protocol/index.js").ProtocolSession["snapshot"] {
    return {
        id: "agent-1",
        messages: [],
        modelId: "openai/test",
        providerId: "codex",
        queue: [],
        status: "idle",
        tools: [],
    };
}

function readSessionPersistenceCounts(
    database: DatabaseSync,
    sessionId: string,
): { eventCount: number; globalEventCount: number; messageCount: number } {
    return {
        eventCount: (
            database
                .prepare("SELECT COUNT(*) AS count FROM session_events WHERE session_id = ?")
                .get(sessionId) as { count: number }
        ).count,
        globalEventCount: (
            database.prepare("SELECT COUNT(*) AS count FROM durable_global_events").get() as {
                count: number;
            }
        ).count,
        messageCount: (
            database
                .prepare("SELECT COUNT(*) AS count FROM session_messages WHERE session_id = ?")
                .get(sessionId) as { count: number }
        ).count,
    };
}

function readLegacyRepairDatabaseState(
    databasePath: string,
    sessionId: string,
): {
    contextJson: string | null;
    globalEventCount: number;
    globalLastCursor: number;
    lastEventId: string | null;
    messageIds: string[];
    repairEventId: string;
    sessionEventCount: number;
    updatedAt: number;
} {
    const database = new DatabaseSync(databasePath);
    try {
        const session = database
            .prepare(
                "SELECT context_messages_json, last_event_id, updated_at_ms FROM sessions WHERE id = ?",
            )
            .get(sessionId) as {
            context_messages_json: string | null;
            last_event_id: string | null;
            updated_at_ms: number;
        };
        const repairEvents = database
            .prepare(
                "SELECT event_id FROM session_events WHERE session_id = ? AND type = 'steering_applied' ORDER BY seq",
            )
            .all(sessionId) as { event_id: string }[];
        const globalState = database
            .prepare("SELECT last_cursor FROM durable_global_event_queue_state WHERE id = 1")
            .get() as { last_cursor: number };
        const globalEventCount = (
            database.prepare("SELECT COUNT(*) AS count FROM durable_global_events").get() as {
                count: number;
            }
        ).count;
        const sessionEventCount = (
            database
                .prepare("SELECT COUNT(*) AS count FROM session_events WHERE session_id = ?")
                .get(sessionId) as { count: number }
        ).count;
        return {
            contextJson: session.context_messages_json,
            globalEventCount,
            globalLastCursor: globalState.last_cursor,
            lastEventId: session.last_event_id,
            messageIds: (
                database
                    .prepare(
                        "SELECT message_id FROM session_messages WHERE session_id = ? ORDER BY position",
                    )
                    .all(sessionId) as { message_id: string }[]
            ).map((row) => row.message_id),
            repairEventId: repairEvents.at(-1)?.event_id ?? "",
            sessionEventCount,
            updatedAt: session.updated_at_ms,
        };
    } finally {
        database.close();
    }
}
