import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import type { EventId } from "../protocol/index.js";
import type { PersistedSessionState } from "./InMemorySession.js";
import { PersistentGlobalEventQueue } from "./PersistentGlobalEventQueue.js";
import { PersistentSessionStore } from "./PersistentSessionStore.js";
import { repairLegacyOrphanedSteering } from "./repairLegacyOrphanedSteering.js";

describe("repairLegacyOrphanedSteering", () => {
    it("rolls back message, context, event, last-event, and global cursor together", async () => {
        const directory = await mkdtemp(join(tmpdir(), "rig-legacy-steering-atomicity-"));
        const databasePath = join(directory, "sessions.sqlite");
        try {
            const laterMessage = {
                blocks: [{ text: "later stored run", type: "text" as const }],
                id: "later-message",
                role: "user" as const,
            };
            const store = new PersistentSessionStore({
                databasePath,
                durableGlobalEventQueue: true,
            });
            store.saveSession({ ...sessionState(), contextMessages: [laterMessage] });
            store.upsertMessage("session-1", {
                isPartial: false,
                message: laterMessage,
                position: 0,
                runId: "run-2",
            });
            store.close();

            const database = new DatabaseSync(databasePath);
            const insert = database.prepare(
                "INSERT INTO session_events (session_id, event_id, type, created_at_ms, data_json) VALUES (?, ?, ?, ?, ?)",
            );
            insert.run(
                "session-1",
                "started",
                "run_started",
                1,
                JSON.stringify({ runId: "run-1" }),
            );
            insert.run(
                "session-1",
                "submitted",
                "message_submitted",
                2,
                JSON.stringify({
                    delivery: "steer",
                    displayText: "repair atomically",
                    message: {
                        blocks: [{ text: "repair atomically", type: "text" }],
                        id: "legacy-message",
                        role: "user",
                    },
                    runId: "run-1",
                }),
            );
            insert.run(
                "session-1",
                "later-submitted",
                "message_submitted",
                3,
                JSON.stringify({
                    delivery: "run",
                    displayText: "later stored run",
                    message: laterMessage,
                    runId: "run-2",
                }),
            );
            insert.run(
                "session-1",
                "finished",
                "run_finished",
                4,
                JSON.stringify({
                    agentRunId: "agent-run-1",
                    modelLocked: true,
                    runId: "run-1",
                    stopReason: "aborted",
                }),
            );
            database.exec(
                `
                CREATE TRIGGER fail_legacy_repair_after_rewrite
                BEFORE UPDATE OF last_event_id ON sessions
                WHEN NEW.last_event_id IS NOT NULL
                BEGIN
                    SELECT RAISE(ABORT, 'forced failure after message and context rewrites');
                END
                `,
            );
            const queue = new PersistentGlobalEventQueue(database);

            expect(() =>
                repairLegacyOrphanedSteering(database, {
                    createEventId: () => "repair-event-id" as EventId,
                    globalEventQueue: queue,
                    now: () => 100,
                }),
            ).toThrow();

            expect(
                database
                    .prepare("SELECT COUNT(*) AS count FROM session_messages WHERE session_id = ?")
                    .get("session-1"),
            ).toEqual({ count: 1 });
            expect(
                database
                    .prepare(
                        "SELECT position, message_id FROM session_messages WHERE session_id = ? ORDER BY position",
                    )
                    .all("session-1"),
            ).toEqual([{ message_id: laterMessage.id, position: 0 }]);
            expect(
                database
                    .prepare(
                        "SELECT context_messages_json, last_event_id FROM sessions WHERE id = ?",
                    )
                    .get("session-1"),
            ).toEqual({
                context_messages_json: JSON.stringify([laterMessage]),
                last_event_id: null,
            });
            expect(
                database
                    .prepare(
                        "SELECT COUNT(*) AS count FROM session_events WHERE session_id = ? AND event_id = ?",
                    )
                    .get("session-1", "repair-event-id"),
            ).toEqual({ count: 0 });
            expect(
                database.prepare("SELECT COUNT(*) AS count FROM durable_global_events").get(),
            ).toEqual({ count: 0 });
            expect(
                database
                    .prepare(
                        "SELECT last_cursor, trimmed_through FROM durable_global_event_queue_state WHERE id = 1",
                    )
                    .get(),
            ).toEqual({ last_cursor: 0, trimmed_through: 0 });
            database.close();
        } finally {
            await rm(directory, { force: true, recursive: true });
        }
    });
});

function sessionState(): PersistedSessionState {
    return {
        agent: { depth: 0, rootSessionId: "session-1", type: "primary" },
        agentId: "agent-1",
        contextMessages: [],
        cwd: "/tmp/rig-legacy-steering-atomicity",
        id: "session-1",
        messages: [],
        modelId: "openai/gpt-5.5",
        models: [],
        nextTaskId: 1,
        permissionMode: "workspace_write",
        providerId: "codex",
        queuedRuns: [],
        status: "aborted",
        tasks: [],
        titleStatus: "idle",
        tools: [],
    };
}
