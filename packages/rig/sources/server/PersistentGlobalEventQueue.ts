import type { DatabaseSync } from "node:sqlite";

import type {
    GlobalEventQueueEntry,
    SessionEvent,
    TrimGlobalEventsResponse,
} from "../protocol/index.js";
import type {
    GlobalEventQueue,
    GlobalEventQueueListener,
    ListGlobalEventQueueOptions,
} from "./GlobalEventQueue.js";
import { shouldPersistGlobalEventType } from "./shouldPersistGlobalEventType.js";

export class PersistentGlobalEventQueue implements GlobalEventQueue {
    readonly #database: DatabaseSync;
    readonly #closeListeners = new Set<() => void>();
    readonly #listeners = new Set<GlobalEventQueueListener>();

    constructor(database: DatabaseSync) {
        this.#database = database;
        this.#initialize();
    }

    persist(event: SessionEvent): GlobalEventQueueEntry | undefined {
        if (!shouldPersistGlobalEventType(event.type)) return undefined;

        const result = this.#database
            .prepare(
                `
                INSERT INTO durable_global_events (
                    event_id,
                    session_id,
                    type,
                    created_at_ms,
                    data_json
                )
                VALUES (?, ?, ?, ?, ?)
                `,
            )
            .run(
                event.id,
                event.sessionId,
                event.type,
                event.createdAt,
                JSON.stringify(event.data),
            );
        const cursor = Number(result.lastInsertRowid);
        this.#database
            .prepare("UPDATE durable_global_event_queue_state SET last_cursor = ? WHERE id = 1")
            .run(cursor);

        const entry = { cursor, event };
        return entry;
    }

    publish(entry: GlobalEventQueueEntry): void {
        for (const listener of this.#listeners) {
            listener(entry);
        }
    }

    deactivate(): void {
        for (const listener of this.#closeListeners) listener();
        this.#closeListeners.clear();
        this.#listeners.clear();
    }

    list(options: ListGlobalEventQueueOptions = {}): readonly GlobalEventQueueEntry[] | undefined {
        const state = this.#state();
        const after = options.after;
        if (after !== undefined && (after < state.trimmedThrough || after > state.lastCursor)) {
            return undefined;
        }

        const limitClause = options.limit === undefined ? "" : "LIMIT ?";
        const values = [after ?? 0, ...(options.limit === undefined ? [] : [options.limit])];
        return this.#database
            .prepare(
                `
                SELECT cursor, event_id, session_id, type, created_at_ms, data_json
                FROM durable_global_events
                WHERE cursor > ?
                ORDER BY cursor ASC
                ${limitClause}
                `,
            )
            .all(...values)
            .map((row) => this.#entry(row));
    }

    subscribe(listener: GlobalEventQueueListener, onClose?: () => void): () => void {
        this.#listeners.add(listener);
        if (onClose !== undefined) this.#closeListeners.add(onClose);
        return () => {
            this.#listeners.delete(listener);
            if (onClose !== undefined) this.#closeListeners.delete(onClose);
        };
    }

    trim(through: number): TrimGlobalEventsResponse | undefined {
        const state = this.#state();
        if (through > state.lastCursor) {
            return undefined;
        }
        if (through <= state.trimmedThrough) {
            return { trimmed: 0, through };
        }

        this.#database.exec("BEGIN IMMEDIATE");
        try {
            const result = this.#database
                .prepare("DELETE FROM durable_global_events WHERE cursor <= ?")
                .run(through);
            this.#database
                .prepare(
                    "UPDATE durable_global_event_queue_state SET trimmed_through = ? WHERE id = 1",
                )
                .run(through);
            this.#database.exec("COMMIT");
            return { trimmed: Number(result.changes), through };
        } catch (error) {
            this.#database.exec("ROLLBACK");
            throw error;
        }
    }

    #entry(row: Record<string, unknown>): GlobalEventQueueEntry {
        return {
            cursor: readNumber(row, "cursor"),
            event: {
                createdAt: readNumber(row, "created_at_ms"),
                data: JSON.parse(readString(row, "data_json")) as SessionEvent["data"],
                id: readString(row, "event_id"),
                sessionId: readString(row, "session_id"),
                type: readString(row, "type") as SessionEvent["type"],
            } as SessionEvent,
        };
    }

    #initialize(): void {
        this.#database.exec(`
            CREATE TABLE IF NOT EXISTS durable_global_events (
                cursor INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL UNIQUE,
                session_id TEXT NOT NULL,
                type TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                data_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS durable_global_event_queue_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                last_cursor INTEGER NOT NULL DEFAULT 0,
                trimmed_through INTEGER NOT NULL DEFAULT 0
            );

            INSERT OR IGNORE INTO durable_global_event_queue_state (
                id,
                last_cursor,
                trimmed_through
            ) VALUES (1, 0, 0);
        `);
    }

    #state(): { lastCursor: number; trimmedThrough: number } {
        const row = this.#database
            .prepare(
                `
                SELECT last_cursor, trimmed_through
                FROM durable_global_event_queue_state
                WHERE id = 1
                `,
            )
            .get();
        if (row === undefined) {
            throw new Error("The durable global event queue is not initialized.");
        }
        return {
            lastCursor: readNumber(row, "last_cursor"),
            trimmedThrough: readNumber(row, "trimmed_through"),
        };
    }
}

function readNumber(row: Record<string, unknown>, key: string): number {
    const value = row[key];
    if (typeof value === "number") return value;
    if (typeof value === "bigint") return Number(value);
    throw new Error(`Expected numeric SQLite column '${key}'.`);
}

function readString(row: Record<string, unknown>, key: string): string {
    const value = row[key];
    if (typeof value === "string") return value;
    throw new Error(`Expected text SQLite column '${key}'.`);
}
