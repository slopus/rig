import type { DatabaseSync } from "node:sqlite";

import type { Message } from "../agent/types.js";
import type { EventId, GlobalEventQueueEntry, SessionEvent } from "../protocol/index.js";
import { findLegacyOrphanedSteering } from "./findLegacyOrphanedSteering.js";
import { isStartupInterruptionRunError } from "./isStartupInterruptionRunError.js";
import { orderMessagesByEventSequence } from "./orderMessagesByEventSequence.js";
import type { PersistentGlobalEventQueue } from "./PersistentGlobalEventQueue.js";

interface StoredMessageRow {
    isPartial: number;
    message: Message;
    messageId: string;
    position: number;
    role: string;
    runId?: string;
    updatedAt: number;
}

export function repairLegacyOrphanedSteering(
    database: DatabaseSync,
    options: {
        createEventId: () => EventId;
        globalEventQueue?: PersistentGlobalEventQueue;
        now: () => number;
    },
): void {
    const globalEntries: GlobalEventQueueEntry[] = [];
    database.exec("BEGIN IMMEDIATE");
    try {
        const sessions = database
            .prepare(
                "SELECT id, context_messages_json, interruption_json FROM sessions ORDER BY created_at_ms ASC",
            )
            .all();
        for (const session of sessions) {
            const sessionId = readString(session, "id");
            const events = loadEvents(database, sessionId);
            markStartupInterruptionEvents(database, events, session);
            const orphaned = findLegacyOrphanedSteering(events);
            if (orphaned.length === 0) continue;

            const sequenceByMessageId = new Map<string, number>();
            for (const event of events) {
                if (event.type !== "message_submitted" && event.type !== "agent_message") continue;
                if (!sequenceByMessageId.has(event.data.message.id)) {
                    sequenceByMessageId.set(event.data.message.id, event.seq);
                }
            }

            const storedRows = database
                .prepare(
                    `
                    SELECT position, message_id, role, is_partial, run_id, message_json, updated_at_ms
                    FROM session_messages
                    WHERE session_id = ?
                    ORDER BY position
                    `,
                )
                .all(sessionId)
                .map(readStoredMessageRow);
            const storedMessageIds = new Set(storedRows.map((row) => row.messageId));
            const contextJson = readOptionalString(session, "context_messages_json");
            const contextMessages =
                contextJson === undefined ? undefined : (JSON.parse(contextJson) as Message[]);
            const repairedRows: StoredMessageRow[] = [];
            const repairedContext: { message: Message; messageId: string }[] = [];
            let lastEventId: string | undefined;

            for (const group of orphaned) {
                for (const submitted of group.events) {
                    const message = submitted.data.message;
                    if (!storedMessageIds.has(message.id)) {
                        repairedRows.push({
                            isPartial: 0,
                            message,
                            messageId: message.id,
                            position: -1,
                            role: message.role,
                            runId: group.runId,
                            updatedAt: options.now(),
                        });
                        storedMessageIds.add(message.id);
                    }
                    repairedContext.push({ message, messageId: message.id });
                }

                const event: Extract<SessionEvent, { type: "steering_applied" }> = {
                    createdAt: options.now(),
                    data: {
                        messageIds: group.events.map((event) => event.data.message.id),
                        runId: group.runId,
                    },
                    id: options.createEventId(),
                    sessionId,
                    type: "steering_applied",
                };
                database
                    .prepare(
                        `
                        INSERT INTO session_events (
                            session_id,
                            event_id,
                            type,
                            created_at_ms,
                            data_json
                        ) VALUES (?, ?, ?, ?, ?)
                        `,
                    )
                    .run(
                        event.sessionId,
                        event.id,
                        event.type,
                        event.createdAt,
                        JSON.stringify(event.data),
                    );
                const globalEntry = options.globalEventQueue?.persist(event);
                if (globalEntry !== undefined) globalEntries.push(globalEntry);
                lastEventId = event.id;
            }

            if (repairedRows.length > 0) {
                rewriteStoredMessages(
                    database,
                    sessionId,
                    orderMessagesByEventSequence(storedRows, repairedRows, sequenceByMessageId),
                );
            }
            if (contextMessages !== undefined) {
                const orderedContext = orderMessagesByEventSequence(
                    contextMessages.map((message) => ({ message, messageId: message.id })),
                    repairedContext,
                    sequenceByMessageId,
                ).map((entry) => entry.message);
                if (JSON.stringify(orderedContext) !== JSON.stringify(contextMessages)) {
                    database
                        .prepare("UPDATE sessions SET context_messages_json = ? WHERE id = ?")
                        .run(JSON.stringify(orderedContext), sessionId);
                }
            }
            if (lastEventId !== undefined) {
                database
                    .prepare(
                        "UPDATE sessions SET last_event_id = ?, updated_at_ms = ? WHERE id = ?",
                    )
                    .run(lastEventId, options.now(), sessionId);
            }
        }
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }

    for (const entry of globalEntries) options.globalEventQueue?.publish(entry);
}

function loadEvents(database: DatabaseSync, sessionId: string): (SessionEvent & { seq: number })[] {
    return database
        .prepare(
            `
            SELECT seq, event_id, type, created_at_ms, data_json
            FROM session_events
            WHERE session_id = ?
            ORDER BY seq ASC
            `,
        )
        .all(sessionId)
        .map((row) => ({
            createdAt: readNumber(row, "created_at_ms"),
            data: JSON.parse(readString(row, "data_json")) as SessionEvent["data"],
            id: readString(row, "event_id"),
            seq: readNumber(row, "seq"),
            sessionId,
            type: readString(row, "type") as SessionEvent["type"],
        })) as (SessionEvent & { seq: number })[];
}

function readStoredMessageRow(row: Record<string, unknown>): StoredMessageRow {
    const runId = readOptionalString(row, "run_id");
    return {
        isPartial: readNumber(row, "is_partial"),
        message: JSON.parse(readString(row, "message_json")) as Message,
        messageId: readString(row, "message_id"),
        position: readNumber(row, "position"),
        role: readString(row, "role"),
        ...(runId === undefined ? {} : { runId }),
        updatedAt: readNumber(row, "updated_at_ms"),
    };
}

function rewriteStoredMessages(
    database: DatabaseSync,
    sessionId: string,
    ordered: readonly StoredMessageRow[],
): void {
    const temporaryOffset =
        ordered.reduce((highest, row) => Math.max(highest, row.position), -1) + ordered.length + 1;
    database
        .prepare("UPDATE session_messages SET position = position + ? WHERE session_id = ?")
        .run(temporaryOffset, sessionId);
    const update = database.prepare(
        "UPDATE session_messages SET position = ? WHERE session_id = ? AND position = ?",
    );
    const insert = database.prepare(
        `
        INSERT INTO session_messages (
            session_id, position, message_id, role, is_partial, run_id, message_json, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
    );
    ordered.forEach((row, position) => {
        if (row.position >= 0) {
            update.run(position, sessionId, row.position + temporaryOffset);
            return;
        }
        insert.run(
            sessionId,
            position,
            row.messageId,
            row.role,
            row.isPartial,
            row.runId ?? null,
            JSON.stringify(row.message),
            row.updatedAt,
        );
    });
}

function markStartupInterruptionEvents(
    database: DatabaseSync,
    events: (SessionEvent & { seq: number })[],
    session: Record<string, unknown>,
): void {
    const interruptionJson = readOptionalString(session, "interruption_json");
    const interruption =
        interruptionJson === undefined
            ? undefined
            : (JSON.parse(interruptionJson) as { message?: unknown; runId?: unknown });
    const update = database.prepare(
        "UPDATE session_events SET data_json = ? WHERE session_id = ? AND event_id = ?",
    );
    for (const event of events) {
        if (event.type !== "run_error" || event.data.startupInterruption === true) continue;
        const matchesPersistedInterruption =
            event.data.runId === interruption?.runId &&
            event.data.errorMessage === interruption.message;
        if (!matchesPersistedInterruption && !isStartupInterruptionRunError(event)) continue;
        event.data.startupInterruption = true;
        update.run(JSON.stringify(event.data), event.sessionId, event.id);
    }
}

function readNumber(row: Record<string, unknown>, key: string): number {
    const value = row[key];
    if (typeof value === "number") return value;
    if (typeof value === "bigint") return Number(value);
    throw new Error(`Expected numeric SQLite column '${key}'.`);
}

function readOptionalString(row: Record<string, unknown>, key: string): string | undefined {
    const value = row[key];
    if (value === null || value === undefined) return undefined;
    if (typeof value === "string") return value;
    throw new Error(`Expected text SQLite column '${key}'.`);
}

function readString(row: Record<string, unknown>, key: string): string {
    const value = readOptionalString(row, key);
    if (value !== undefined) return value;
    throw new Error(`Expected text SQLite column '${key}'.`);
}
