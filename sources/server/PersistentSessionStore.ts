import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createEventIdFactory } from "../protocol/index.js";
import type {
    ChangeEffortRequest,
    ChangeModelRequest,
    CreateSessionRequest,
    ModelCatalog,
    SessionEvent,
    SessionInterruption,
    SessionSummary,
    SessionTitleStatus,
} from "../protocol/index.js";
import type { Message } from "../agent/types.js";
import type { Model } from "../providers/types.js";
import {
    InMemorySession,
    type InMemorySessionPersistence,
    type PersistedQueuedRun,
    type PersistedSessionMessage,
    type PersistedSessionState,
} from "./InMemorySession.js";
import { createModelCatalog } from "./createModelCatalog.js";
import type { SessionStore } from "./SessionStore.js";

export interface PersistentSessionStoreOptions {
    databasePath: string;
    modelCatalog?: ModelCatalog;
    now?: () => number;
}

export class PersistentSessionStore implements SessionStore, InMemorySessionPersistence {
    #createEventId = createEventIdFactory();
    #database: DatabaseSync;
    #modelCatalog: ModelCatalog;
    #now: () => number;
    #sessions = new Map<string, InMemorySession>();

    constructor(options: PersistentSessionStoreOptions) {
        this.#modelCatalog = options.modelCatalog ?? createModelCatalog();
        this.#now = options.now ?? Date.now;
        if (options.databasePath !== ":memory:") {
            mkdirSync(dirname(options.databasePath), { mode: 0o700, recursive: true });
        }
        this.#database = new DatabaseSync(options.databasePath, {
            enableForeignKeyConstraints: true,
            timeout: 5_000,
        });
        this.#initialize();
        if (options.databasePath !== ":memory:") {
            chmodSync(options.databasePath, 0o600);
        }
        this.#repairInterruptedTitleGenerations();
        this.repairInterruptedSessions("crash");
    }

    changeModel(sessionId: string, request: ChangeModelRequest): InMemorySession | undefined {
        const session = this.get(sessionId);
        if (session === undefined) {
            return undefined;
        }

        session.changeModel(request);
        return session;
    }

    changeEffort(sessionId: string, request: ChangeEffortRequest): InMemorySession | undefined {
        const session = this.get(sessionId);
        if (session === undefined) {
            return undefined;
        }

        session.changeEffort(request);
        return session;
    }

    clearMessages(sessionId: string): void {
        this.#database.prepare("DELETE FROM session_messages WHERE session_id = ?").run(sessionId);
    }

    close(): void {
        this.#database.close();
    }

    create(request: CreateSessionRequest): InMemorySession {
        const session = new InMemorySession({
            createEventId: this.#createEventId,
            emitCreatedEvent: false,
            modelCatalog: this.#modelCatalog,
            onAppendEvent: (event) => this.#appendEvent(event),
            persistence: this,
            request,
        });
        this.#sessions.set(session.id, session);
        session.emitCreatedEvent();
        return session;
    }

    deleteQueuedRun(sessionId: string, runId: string): void {
        this.#database
            .prepare("DELETE FROM queued_runs WHERE session_id = ? AND run_id = ?")
            .run(sessionId, runId);
    }

    get(sessionId: string): InMemorySession | undefined {
        const existing = this.#sessions.get(sessionId);
        if (existing !== undefined) {
            return existing;
        }

        const session = this.#loadSession(sessionId);
        if (session !== undefined) {
            this.#sessions.set(sessionId, session);
        }
        return session;
    }

    insertQueuedRun(sessionId: string, run: PersistedQueuedRun): void {
        this.#database
            .prepare(
                `
                INSERT INTO queued_runs (
                    session_id,
                    run_id,
                    display_text,
                    text,
                    user_message_json,
                    created_at_ms
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id, run_id) DO UPDATE SET
                    display_text = excluded.display_text,
                    text = excluded.text,
                    user_message_json = excluded.user_message_json
                `,
            )
            .run(
                sessionId,
                run.runId,
                run.displayText,
                run.text,
                JSON.stringify(run.userMessage),
                this.#now(),
            );
    }

    list(options: { limit?: number } = {}): readonly SessionSummary[] {
        const rows = this.#database
            .prepare(
                `
                SELECT
                    id,
                    cwd,
                    provider_id,
                    model_id,
                    effort,
                    status,
                    title,
                    title_status,
                    title_error,
                    interruption_json,
                    created_at_ms,
                    updated_at_ms,
                    last_message_at_ms
                FROM sessions
                ORDER BY
                    last_message_at_ms IS NULL ASC,
                    last_message_at_ms DESC,
                    updated_at_ms DESC
                LIMIT ?
                `,
            )
            .all(options.limit ?? 500);

        return rows.map((row) => {
            const effort = readOptionalString(row, "effort");
            const title = readOptionalString(row, "title");
            const titleError = readOptionalString(row, "title_error");
            const lastMessageAt = readOptionalNumber(row, "last_message_at_ms");
            const interruptionJson = readOptionalString(row, "interruption_json");
            return {
                id: readString(row, "id"),
                cwd: readString(row, "cwd"),
                providerId: readString(row, "provider_id"),
                modelId: readString(row, "model_id"),
                ...(effort !== undefined ? { effort } : {}),
                status: readString(row, "status") as SessionSummary["status"],
                titleStatus: readString(row, "title_status") as SessionTitleStatus,
                createdAt: readNumber(row, "created_at_ms"),
                updatedAt: readNumber(row, "updated_at_ms"),
                ...(lastMessageAt !== undefined ? { lastMessageAt } : {}),
                ...(title !== undefined ? { title } : {}),
                ...(titleError !== undefined ? { titleError } : {}),
                ...(interruptionJson !== undefined
                    ? { interruption: JSON.parse(interruptionJson) as SessionInterruption }
                    : {}),
            };
        });
    }

    repairInterruptedSessions(reason: SessionInterruption["reason"]): void {
        const rows = this.#database
            .prepare(
                `
                SELECT DISTINCT sessions.id
                FROM sessions
                LEFT JOIN queued_runs ON queued_runs.session_id = sessions.id
                WHERE sessions.status IN ('queued', 'running')
                    OR sessions.active_run_id IS NOT NULL
                    OR queued_runs.run_id IS NOT NULL
                `,
            )
            .all();

        for (const row of rows) {
            const sessionId = readString(row, "id");
            const session = this.get(sessionId);
            if (session === undefined) {
                continue;
            }

            const state = session.state();
            const runId = state.activeRunId ?? state.queuedRuns.at(0)?.runId;
            session.markInterrupted({
                interruptedAt: this.#now(),
                message:
                    reason === "crash"
                        ? "The session was interrupted because the local server stopped before the run completed."
                        : "The session was interrupted because the local server shut down before the run completed.",
                reason,
                ...(runId !== undefined ? { runId } : {}),
            });
        }
    }

    saveSession(state: PersistedSessionState): void {
        this.#database
            .prepare(
                `
                INSERT INTO sessions (
                    id,
                    agent_id,
                    cwd,
                    provider_id,
                    model_id,
                    effort,
                    instructions,
                    status,
                    active_run_id,
                    models_json,
                    tools_json,
                    title,
                    title_status,
                    title_error,
                    interrupted,
                    interruption_json,
                    last_message_at_ms,
                    created_at_ms,
                    updated_at_ms
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    agent_id = excluded.agent_id,
                    cwd = excluded.cwd,
                    provider_id = excluded.provider_id,
                    model_id = excluded.model_id,
                    effort = excluded.effort,
                    instructions = excluded.instructions,
                    status = excluded.status,
                    active_run_id = excluded.active_run_id,
                    models_json = excluded.models_json,
                    tools_json = excluded.tools_json,
                    title = excluded.title,
                    title_status = excluded.title_status,
                    title_error = excluded.title_error,
                    interrupted = excluded.interrupted,
                    interruption_json = excluded.interruption_json,
                    last_message_at_ms = excluded.last_message_at_ms,
                    updated_at_ms = excluded.updated_at_ms
                `,
            )
            .run(
                state.id,
                state.agentId,
                state.cwd,
                state.providerId,
                state.modelId,
                state.effort ?? null,
                state.instructions ?? null,
                state.status,
                state.activeRunId ?? null,
                JSON.stringify(state.models),
                JSON.stringify(state.tools),
                state.title ?? null,
                state.titleStatus,
                state.titleError ?? null,
                state.interruption === undefined ? 0 : 1,
                state.interruption === undefined ? null : JSON.stringify(state.interruption),
                state.lastMessageAt ?? null,
                this.#now(),
                this.#now(),
            );
    }

    upsertMessage(sessionId: string, message: PersistedSessionMessage): void {
        this.#database
            .prepare(
                `
                INSERT INTO session_messages (
                    session_id,
                    position,
                    message_id,
                    role,
                    is_partial,
                    run_id,
                    message_json,
                    updated_at_ms
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id, position) DO UPDATE SET
                    message_id = excluded.message_id,
                    role = excluded.role,
                    is_partial = excluded.is_partial,
                    run_id = excluded.run_id,
                    message_json = excluded.message_json,
                    updated_at_ms = excluded.updated_at_ms
                `,
            )
            .run(
                sessionId,
                message.position,
                message.message.id,
                message.message.role,
                message.isPartial ? 1 : 0,
                message.runId ?? null,
                JSON.stringify(message.message),
                this.#now(),
            );
    }

    #appendEvent(event: SessionEvent): void {
        this.#transaction(() => {
            this.#database
                .prepare(
                    `
                    INSERT INTO session_events (
                        session_id,
                        event_id,
                        type,
                        created_at_ms,
                        data_json
                    )
                    VALUES (?, ?, ?, ?, ?)
                    `,
                )
                .run(
                    event.sessionId,
                    event.id,
                    event.type,
                    event.createdAt,
                    JSON.stringify(event.data),
                );
            this.#database
                .prepare(
                    `
                    UPDATE sessions
                    SET last_event_id = ?, updated_at_ms = ?
                    WHERE id = ?
                    `,
                )
                .run(event.id, this.#now(), event.sessionId);
        });
    }

    #initialize(): void {
        this.#database.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 5000;

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                cwd TEXT NOT NULL,
                provider_id TEXT NOT NULL,
                model_id TEXT NOT NULL,
                effort TEXT,
                instructions TEXT,
                status TEXT NOT NULL,
                active_run_id TEXT,
                last_event_id TEXT,
                models_json TEXT NOT NULL,
                tools_json TEXT NOT NULL,
                title TEXT,
                title_status TEXT NOT NULL DEFAULT 'idle',
                title_error TEXT,
                interrupted INTEGER NOT NULL DEFAULT 0,
                interruption_json TEXT,
                last_message_at_ms INTEGER,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS session_events (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                event_id TEXT NOT NULL UNIQUE,
                type TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                data_json TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS session_events_session_seq
                ON session_events(session_id, seq);

            CREATE TABLE IF NOT EXISTS session_messages (
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                position INTEGER NOT NULL,
                message_id TEXT NOT NULL,
                role TEXT NOT NULL,
                is_partial INTEGER NOT NULL DEFAULT 0,
                run_id TEXT,
                message_json TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                PRIMARY KEY (session_id, position)
            );

            CREATE INDEX IF NOT EXISTS session_messages_session_message
                ON session_messages(session_id, message_id);

            CREATE TABLE IF NOT EXISTS queued_runs (
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                run_id TEXT NOT NULL,
                display_text TEXT NOT NULL,
                text TEXT NOT NULL,
                user_message_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                PRIMARY KEY (session_id, run_id)
            );
        `);
        this.#ensureSessionColumn("title", "TEXT");
        this.#ensureSessionColumn("title_status", "TEXT NOT NULL DEFAULT 'idle'");
        this.#ensureSessionColumn("title_error", "TEXT");
        this.#ensureSessionColumn("last_message_at_ms", "INTEGER");
    }

    #loadEvents(sessionId: string): SessionEvent[] {
        return this.#database
            .prepare(
                `
                SELECT event_id, type, created_at_ms, data_json
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
                sessionId,
                type: readString(row, "type") as SessionEvent["type"],
            })) as SessionEvent[];
    }

    #loadMessages(sessionId: string): PersistedSessionMessage[] {
        return this.#database
            .prepare(
                `
                SELECT position, is_partial, run_id, message_json
                FROM session_messages
                WHERE session_id = ?
                ORDER BY position ASC
                `,
            )
            .all(sessionId)
            .map((row) => {
                const runId = readOptionalString(row, "run_id");
                const message: PersistedSessionMessage = {
                    isPartial: readNumber(row, "is_partial") !== 0,
                    message: JSON.parse(readString(row, "message_json")) as Message,
                    position: readNumber(row, "position"),
                };
                if (runId !== undefined) {
                    message.runId = runId;
                }
                return message;
            });
    }

    #loadQueuedRuns(sessionId: string): PersistedQueuedRun[] {
        return this.#database
            .prepare(
                `
                SELECT run_id, display_text, text, user_message_json
                FROM queued_runs
                WHERE session_id = ?
                ORDER BY created_at_ms ASC
                `,
            )
            .all(sessionId)
            .map((row) => ({
                displayText: readString(row, "display_text"),
                runId: readString(row, "run_id"),
                text: readString(row, "text"),
                userMessage: JSON.parse(readString(row, "user_message_json")),
            })) as PersistedQueuedRun[];
    }

    #loadSession(sessionId: string): InMemorySession | undefined {
        const row = this.#database
            .prepare(
                `
                SELECT *
                FROM sessions
                WHERE id = ?
                `,
            )
            .get(sessionId);
        if (row === undefined) {
            return undefined;
        }

        const effort = readOptionalString(row, "effort");
        const instructions = readOptionalString(row, "instructions");
        const interruptionJson = readOptionalString(row, "interruption_json");
        const lastMessageAt = readOptionalNumber(row, "last_message_at_ms");
        const modelId = readString(row, "model_id");
        const title = readOptionalString(row, "title");
        const titleError = readOptionalString(row, "title_error");
        const activeRunId = readOptionalString(row, "active_run_id");
        const restore: PersistedSessionState = {
            agentId: readString(row, "agent_id"),
            cwd: readString(row, "cwd"),
            ...(effort !== undefined ? { effort } : {}),
            id: readString(row, "id"),
            ...(instructions !== undefined ? { instructions } : {}),
            ...(interruptionJson !== undefined
                ? { interruption: JSON.parse(interruptionJson) as SessionInterruption }
                : {}),
            ...(lastMessageAt !== undefined ? { lastMessageAt } : {}),
            messages: this.#loadMessages(sessionId),
            modelId,
            models: JSON.parse(readString(row, "models_json")) as Model[],
            providerId: readString(row, "provider_id"),
            queuedRuns: this.#loadQueuedRuns(sessionId),
            status: readString(row, "status") as PersistedSessionState["status"],
            ...(title !== undefined ? { title } : {}),
            ...(titleError !== undefined ? { titleError } : {}),
            titleStatus: readString(row, "title_status") as SessionTitleStatus,
            tools: JSON.parse(readString(row, "tools_json")) as string[],
        };
        if (activeRunId !== undefined) {
            restore.activeRunId = activeRunId;
        }

        const request: CreateSessionRequest = {
            cwd: restore.cwd,
            ...(restore.effort !== undefined ? { effort: restore.effort } : {}),
            ...(restore.instructions !== undefined ? { instructions: restore.instructions } : {}),
            modelId,
        };
        return new InMemorySession({
            createEventId: this.#createEventId,
            events: this.#loadEvents(sessionId),
            modelCatalog: this.#modelCatalog,
            onAppendEvent: (event) => this.#appendEvent(event),
            persistence: this,
            request,
            restore,
        });
    }

    #repairInterruptedTitleGenerations(): void {
        this.#database
            .prepare(
                `
                UPDATE sessions
                SET
                    title_status = 'error',
                    title_error = 'Title generation was interrupted because the local server stopped.',
                    updated_at_ms = ?
                WHERE title_status = 'generating'
                `,
            )
            .run(this.#now());
    }

    #transaction<T>(body: () => T): T {
        this.#database.exec("BEGIN IMMEDIATE");
        try {
            const value = body();
            this.#database.exec("COMMIT");
            return value;
        } catch (error) {
            this.#database.exec("ROLLBACK");
            throw error;
        }
    }

    #ensureSessionColumn(name: string, definition: string): void {
        const columns = this.#database.prepare("PRAGMA table_info(sessions)").all();
        if (columns.some((column) => readString(column, "name") === name)) {
            return;
        }
        this.#database.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${definition}`);
    }
}

function readNumber(row: Record<string, unknown>, key: string): number {
    const value = row[key];
    if (typeof value === "number") {
        return value;
    }
    if (typeof value === "bigint") {
        return Number(value);
    }

    throw new Error(`Expected numeric SQLite column '${key}'.`);
}

function readOptionalString(row: Record<string, unknown>, key: string): string | undefined {
    const value = row[key];
    if (value === null || value === undefined) {
        return undefined;
    }
    if (typeof value !== "string") {
        throw new Error(`Expected text SQLite column '${key}'.`);
    }
    return value;
}

function readOptionalNumber(row: Record<string, unknown>, key: string): number | undefined {
    const value = row[key];
    if (value === null || value === undefined) {
        return undefined;
    }
    return readNumber(row, key);
}

function readString(row: Record<string, unknown>, key: string): string {
    const value = readOptionalString(row, key);
    if (value === undefined) {
        throw new Error(`Expected text SQLite column '${key}'.`);
    }
    return value;
}
