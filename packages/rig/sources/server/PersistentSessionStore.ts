import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createEventIdFactory } from "../protocol/index.js";
import type {
    ChangeEffortRequest,
    ChangeModelRequest,
    ChangeServiceTierRequest,
    CreateSessionRequest,
    ModelCatalog,
    SessionEvent,
    SessionAgentMetadata,
    SessionInterruption,
    SessionSummary,
    SubagentSummary,
    SessionTitleStatus,
} from "../protocol/index.js";
import type { Message } from "../agent/types.js";
import type { Model } from "../providers/types.js";
import type { SessionGoal } from "../goals/index.js";
import { parsePermissionMode } from "../permissions/index.js";
import {
    InMemorySession,
    type InMemorySessionPersistence,
    type PersistedQueuedRun,
    type PersistedSessionMessage,
    type PersistedSessionState,
    type PersistedWorkflowRun,
} from "./InMemorySession.js";
import { AgentSessionManager } from "./AgentSessionManager.js";
import { createModelCatalog } from "./createModelCatalog.js";
import type { GlobalEventQueue } from "./GlobalEventQueue.js";
import { PersistentGlobalEventQueue } from "./PersistentGlobalEventQueue.js";
import type { SessionStore } from "./SessionStore.js";
import type { McpToolProvider } from "../mcp/index.js";
import type { DockerExecutionConfig } from "../execution/index.js";
import { summarizeDockerExecution } from "../execution/index.js";

export interface PersistentSessionStoreOptions {
    databasePath: string;
    durableGlobalEventQueue?: boolean;
    mcpToolProvider?: McpToolProvider;
    modelCatalog?: ModelCatalog;
    now?: () => number;
}

export class PersistentSessionStore implements SessionStore, InMemorySessionPersistence {
    #agentManager: AgentSessionManager;
    #createEventId = createEventIdFactory();
    #database: DatabaseSync;
    #modelCatalog: ModelCatalog;
    #mcpToolProvider: McpToolProvider | undefined;
    #now: () => number;
    #persistentGlobalEventQueue: PersistentGlobalEventQueue | undefined;
    #sessions = new Map<string, InMemorySession>();

    constructor(options: PersistentSessionStoreOptions) {
        this.#modelCatalog = options.modelCatalog ?? createModelCatalog();
        this.#mcpToolProvider = options.mcpToolProvider;
        this.#now = options.now ?? Date.now;
        if (options.databasePath !== ":memory:") {
            mkdirSync(dirname(options.databasePath), { mode: 0o700, recursive: true });
        }
        this.#database = new DatabaseSync(options.databasePath, {
            enableForeignKeyConstraints: true,
            timeout: 5_000,
        });
        this.#initialize();
        if (options.durableGlobalEventQueue === true) {
            this.#persistentGlobalEventQueue = new PersistentGlobalEventQueue(this.#database);
        }
        this.#agentManager = new AgentSessionManager({
            repository: {
                createSubagent: (request, metadata) => this.#createSession(request, metadata),
                get: (sessionId) => this.get(sessionId),
                listByRoot: (rootSessionId) => this.#listSubagentSessionsByRoot(rootSessionId),
            },
        });
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

    changeServiceTier(
        sessionId: string,
        request: ChangeServiceTierRequest,
    ): InMemorySession | undefined {
        const session = this.get(sessionId);
        if (session === undefined) return undefined;
        session.changeServiceTier(request);
        return session;
    }

    clearMessages(sessionId: string): void {
        this.#database.prepare("DELETE FROM session_messages WHERE session_id = ?").run(sessionId);
    }

    deleteMessagesFrom(sessionId: string, position: number): void {
        this.#database
            .prepare("DELETE FROM session_messages WHERE session_id = ? AND position >= ?")
            .run(sessionId, position);
    }

    close(): void {
        this.#database.close();
    }

    create(request: CreateSessionRequest): InMemorySession {
        return this.#createSession(request);
    }

    fork(sessionId: string): InMemorySession | undefined {
        const source = this.get(sessionId);
        if (source === undefined) return undefined;
        const state = source.createForkState();
        const session = new InMemorySession({
            agentManager: this.#agentManager,
            createEventId: this.#createEventId,
            emitCreatedEvent: false,
            modelCatalog: this.#modelCatalog,
            ...(this.#mcpToolProvider !== undefined
                ? { mcpToolProvider: this.#mcpToolProvider }
                : {}),
            onAppendEvent: (event) => this.#appendEvent(event),
            persistence: this,
            request: source.requestForSubagent(),
            restore: state,
        });
        this.#sessions.set(session.id, session);
        this.#transaction(() => {
            for (const message of state.messages) {
                this.upsertMessage(session.id, message);
            }
        });
        session.emitCreatedEvent();
        return session;
    }

    #createSession(
        request: CreateSessionRequest,
        metadata?: SessionAgentMetadata,
    ): InMemorySession {
        const session = new InMemorySession({
            agentManager: this.#agentManager,
            createEventId: this.#createEventId,
            emitCreatedEvent: false,
            modelCatalog: this.#modelCatalog,
            ...(this.#mcpToolProvider !== undefined
                ? { mcpToolProvider: this.#mcpToolProvider }
                : {}),
            ...(metadata !== undefined ? { metadata } : {}),
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

    get globalEventQueue(): GlobalEventQueue | undefined {
        return this.#persistentGlobalEventQueue;
    }

    setDurableGlobalEventQueue(enabled: boolean): GlobalEventQueue | undefined {
        if (enabled) {
            this.#persistentGlobalEventQueue ??= new PersistentGlobalEventQueue(this.#database);
        } else {
            this.#persistentGlobalEventQueue?.deactivate();
            this.#persistentGlobalEventQueue = undefined;
        }
        return this.#persistentGlobalEventQueue;
    }

    insertQueuedRun(sessionId: string, run: PersistedQueuedRun): void {
        this.#database
            .prepare(
                `
                INSERT INTO queued_runs (
                    session_id,
                    run_id,
                    display_text,
                    kind,
                    text,
                    user_message_json,
                    created_at_ms
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id, run_id) DO UPDATE SET
                    display_text = excluded.display_text,
                    kind = excluded.kind,
                    text = excluded.text,
                    user_message_json = excluded.user_message_json
                `,
            )
            .run(
                sessionId,
                run.runId,
                run.displayText,
                run.kind,
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
                    docker_json,
                    provider_id,
                    model_id,
                    permission_mode,
                    effort,
                    service_tier,
                    status,
                    title,
                    title_status,
                    title_error,
                    interruption_json,
                    created_at_ms,
                    updated_at_ms,
                    last_message_at_ms
                FROM sessions
                WHERE parent_session_id IS NULL
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
            const serviceTier = readOptionalString(row, "service_tier");
            const title = readOptionalString(row, "title");
            const titleError = readOptionalString(row, "title_error");
            const lastMessageAt = readOptionalNumber(row, "last_message_at_ms");
            const interruptionJson = readOptionalString(row, "interruption_json");
            const dockerJson = readOptionalString(row, "docker_json");
            return {
                id: readString(row, "id"),
                cwd: readString(row, "cwd"),
                providerId: readString(row, "provider_id"),
                modelId: readString(row, "model_id"),
                permissionMode: parsePermissionMode(readString(row, "permission_mode")),
                environment: summarizeDockerExecution(
                    dockerJson === undefined
                        ? undefined
                        : (JSON.parse(dockerJson) as DockerExecutionConfig),
                ),
                ...(effort !== undefined ? { effort } : {}),
                ...(serviceTier === "fast" ? { serviceTier } : {}),
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

    listSubagents(parentSessionId: string): readonly SubagentSummary[] {
        return this.#database
            .prepare(
                `
                SELECT
                    id,
                    agent_id,
                    model_id,
                    status,
                    parent_session_id,
                    parent_tool_call_id,
                    task_name,
                    depth,
                    description,
                    created_at_ms,
                    updated_at_ms
                FROM sessions
                WHERE parent_session_id = ?
                ORDER BY created_at_ms ASC
                `,
            )
            .all(parentSessionId)
            .map((row) => {
                const parentToolCallId = readOptionalString(row, "parent_tool_call_id");
                const taskName = readOptionalString(row, "task_name");
                return {
                    agentId: readString(row, "agent_id"),
                    createdAt: readNumber(row, "created_at_ms"),
                    depth: readNumber(row, "depth"),
                    description: readOptionalString(row, "description") ?? "Delegated task",
                    id: readString(row, "id"),
                    modelId: readString(row, "model_id"),
                    parentSessionId: readString(row, "parent_session_id"),
                    ...(parentToolCallId !== undefined ? { parentToolCallId } : {}),
                    status: readString(row, "status") as SubagentSummary["status"],
                    ...(taskName !== undefined ? { taskName } : {}),
                    updatedAt: readNumber(row, "updated_at_ms"),
                };
            });
    }

    #listSubagentSessionsByRoot(rootSessionId: string): readonly InMemorySession[] {
        return this.#database
            .prepare(
                `
                SELECT id
                FROM sessions
                WHERE root_session_id = ? AND session_kind = 'subagent'
                ORDER BY created_at_ms ASC
                `,
            )
            .all(rootSessionId)
            .map((row) => this.get(readString(row, "id")))
            .filter((session): session is InMemorySession => session !== undefined);
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
            const parentSessionId = session.agentMetadata().parentSessionId;
            if (parentSessionId !== undefined) {
                this.get(parentSessionId)?.recordSubagentChanged(session.subagentSummary());
            }
        }
    }

    saveSession(state: PersistedSessionState): void {
        this.#database
            .prepare(
                `
                INSERT INTO sessions (
                    id,
                    agent_id,
                    session_kind,
                    parent_session_id,
                    root_session_id,
                    depth,
                    parent_tool_call_id,
                    task_name,
                    description,
                    cwd,
                    docker_json,
                    provider_id,
                    model_id,
                    effort,
                    service_tier,
                    instructions,
                    status,
                    active_run_id,
                    permission_mode,
                    context_messages_json,
                    models_json,
                    tools_json,
                    tasks_json,
                    workflows_json,
                    workflows_enabled,
                    goal_json,
                    next_task_id,
                    title,
                    title_status,
                    title_error,
                    interrupted,
                    interruption_json,
                    last_message_at_ms,
                    created_at_ms,
                    updated_at_ms
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    agent_id = excluded.agent_id,
                    session_kind = excluded.session_kind,
                    parent_session_id = excluded.parent_session_id,
                    root_session_id = excluded.root_session_id,
                    depth = excluded.depth,
                    parent_tool_call_id = excluded.parent_tool_call_id,
                    task_name = excluded.task_name,
                    description = excluded.description,
                    cwd = excluded.cwd,
                    docker_json = excluded.docker_json,
                    provider_id = excluded.provider_id,
                    model_id = excluded.model_id,
                    effort = excluded.effort,
                    service_tier = excluded.service_tier,
                    instructions = excluded.instructions,
                    status = excluded.status,
                    active_run_id = excluded.active_run_id,
                    permission_mode = excluded.permission_mode,
                    context_messages_json = excluded.context_messages_json,
                    models_json = excluded.models_json,
                    tools_json = excluded.tools_json,
                    tasks_json = excluded.tasks_json,
                    workflows_json = excluded.workflows_json,
                    workflows_enabled = excluded.workflows_enabled,
                    goal_json = excluded.goal_json,
                    next_task_id = excluded.next_task_id,
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
                state.agent.type,
                state.agent.parentSessionId ?? null,
                state.agent.rootSessionId,
                state.agent.depth,
                state.agent.parentToolCallId ?? null,
                state.agent.taskName ?? null,
                state.agent.description ?? null,
                state.cwd,
                state.docker === undefined ? null : JSON.stringify(state.docker),
                state.providerId,
                state.modelId,
                state.effort ?? null,
                state.serviceTier ?? null,
                state.instructions ?? null,
                state.status,
                state.activeRunId ?? null,
                state.permissionMode,
                state.contextMessages === undefined ? null : JSON.stringify(state.contextMessages),
                JSON.stringify(state.models),
                JSON.stringify(state.tools),
                JSON.stringify(state.tasks),
                JSON.stringify(state.workflows ?? []),
                state.workflowsEnabled === false ? 0 : 1,
                state.goal === undefined ? null : JSON.stringify(state.goal),
                state.nextTaskId,
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
        const globalEntry = this.#transaction(() => {
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
            const queued = this.#persistentGlobalEventQueue?.persist(event);
            this.#database
                .prepare(
                    `
                    UPDATE sessions
                    SET last_event_id = ?, updated_at_ms = ?
                    WHERE id = ?
                    `,
                )
                .run(event.id, this.#now(), event.sessionId);
            return queued;
        });
        if (globalEntry !== undefined) this.#persistentGlobalEventQueue?.publish(globalEntry);
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
                session_kind TEXT NOT NULL DEFAULT 'primary',
                parent_session_id TEXT,
                root_session_id TEXT,
                depth INTEGER NOT NULL DEFAULT 0,
                parent_tool_call_id TEXT,
                task_name TEXT,
                description TEXT,
                cwd TEXT NOT NULL,
                docker_json TEXT,
                provider_id TEXT NOT NULL,
                model_id TEXT NOT NULL,
                effort TEXT,
                service_tier TEXT,
                instructions TEXT,
                status TEXT NOT NULL,
                active_run_id TEXT,
                last_event_id TEXT,
                permission_mode TEXT NOT NULL DEFAULT 'workspace_write',
                context_messages_json TEXT,
                models_json TEXT NOT NULL,
                tools_json TEXT NOT NULL,
                tasks_json TEXT NOT NULL DEFAULT '[]',
                workflows_json TEXT NOT NULL DEFAULT '[]',
                workflows_enabled INTEGER NOT NULL DEFAULT 1,
                goal_json TEXT,
                next_task_id INTEGER NOT NULL DEFAULT 1,
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
                kind TEXT NOT NULL DEFAULT 'user',
                text TEXT NOT NULL,
                user_message_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                PRIMARY KEY (session_id, run_id)
            );
        `);
        this.#ensureSessionColumn("title", "TEXT");
        this.#ensureSessionColumn("docker_json", "TEXT");
        this.#ensureSessionColumn("title_status", "TEXT NOT NULL DEFAULT 'idle'");
        this.#ensureSessionColumn("title_error", "TEXT");
        this.#ensureSessionColumn("last_message_at_ms", "INTEGER");
        this.#ensureSessionColumn("session_kind", "TEXT NOT NULL DEFAULT 'primary'");
        this.#ensureSessionColumn("parent_session_id", "TEXT");
        this.#ensureSessionColumn("root_session_id", "TEXT");
        this.#ensureSessionColumn("depth", "INTEGER NOT NULL DEFAULT 0");
        this.#ensureSessionColumn("parent_tool_call_id", "TEXT");
        this.#ensureSessionColumn("task_name", "TEXT");
        this.#ensureSessionColumn("description", "TEXT");
        this.#ensureSessionColumn("context_messages_json", "TEXT");
        this.#ensureSessionColumn("service_tier", "TEXT");
        this.#ensureSessionColumn("permission_mode", "TEXT NOT NULL DEFAULT 'workspace_write'");
        this.#ensureSessionColumn("tasks_json", "TEXT NOT NULL DEFAULT '[]'");
        this.#ensureSessionColumn("workflows_json", "TEXT NOT NULL DEFAULT '[]'");
        this.#ensureSessionColumn("workflows_enabled", "INTEGER NOT NULL DEFAULT 1");
        this.#ensureSessionColumn("goal_json", "TEXT");
        this.#ensureSessionColumn("next_task_id", "INTEGER NOT NULL DEFAULT 1");
        this.#ensureQueuedRunColumn("kind", "TEXT NOT NULL DEFAULT 'user'");
        this.#database.exec(`
            CREATE INDEX IF NOT EXISTS sessions_parent_created
                ON sessions(parent_session_id, created_at_ms)
        `);
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
                SELECT run_id, display_text, kind, text, user_message_json
                FROM queued_runs
                WHERE session_id = ?
                ORDER BY created_at_ms ASC
                `,
            )
            .all(sessionId)
            .map((row) => ({
                displayText: readString(row, "display_text"),
                kind: readString(row, "kind") as PersistedQueuedRun["kind"],
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
        const serviceTier = readOptionalString(row, "service_tier");
        const dockerJson = readOptionalString(row, "docker_json");
        const instructions = readOptionalString(row, "instructions");
        const interruptionJson = readOptionalString(row, "interruption_json");
        const lastMessageAt = readOptionalNumber(row, "last_message_at_ms");
        const modelId = readString(row, "model_id");
        const title = readOptionalString(row, "title");
        const titleError = readOptionalString(row, "title_error");
        const activeRunId = readOptionalString(row, "active_run_id");
        const contextMessagesJson = readOptionalString(row, "context_messages_json");
        const permissionMode = parsePermissionMode(readString(row, "permission_mode"));
        const parentSessionId = readOptionalString(row, "parent_session_id");
        const parentToolCallId = readOptionalString(row, "parent_tool_call_id");
        const taskName = readOptionalString(row, "task_name");
        const description = readOptionalString(row, "description");
        const goalJson = readOptionalString(row, "goal_json");
        const id = readString(row, "id");
        const agent: SessionAgentMetadata = {
            depth: readNumber(row, "depth"),
            rootSessionId: readOptionalString(row, "root_session_id") ?? id,
            type: readString(row, "session_kind") as SessionAgentMetadata["type"],
            ...(description !== undefined ? { description } : {}),
            ...(parentSessionId !== undefined ? { parentSessionId } : {}),
            ...(parentToolCallId !== undefined ? { parentToolCallId } : {}),
            ...(taskName !== undefined ? { taskName } : {}),
        };
        const restore: PersistedSessionState = {
            agent,
            agentId: readString(row, "agent_id"),
            cwd: readString(row, "cwd"),
            ...(dockerJson !== undefined
                ? { docker: JSON.parse(dockerJson) as DockerExecutionConfig }
                : {}),
            ...(contextMessagesJson !== undefined
                ? { contextMessages: JSON.parse(contextMessagesJson) as Message[] }
                : {}),
            ...(effort !== undefined ? { effort } : {}),
            ...(serviceTier === "fast" ? { serviceTier } : {}),
            id,
            ...(instructions !== undefined ? { instructions } : {}),
            ...(goalJson !== undefined ? { goal: JSON.parse(goalJson) as SessionGoal } : {}),
            ...(interruptionJson !== undefined
                ? { interruption: JSON.parse(interruptionJson) as SessionInterruption }
                : {}),
            ...(lastMessageAt !== undefined ? { lastMessageAt } : {}),
            messages: this.#loadMessages(sessionId),
            modelId,
            models: JSON.parse(readString(row, "models_json")) as Model[],
            providerId: readString(row, "provider_id"),
            permissionMode,
            queuedRuns: this.#loadQueuedRuns(sessionId),
            status: readString(row, "status") as PersistedSessionState["status"],
            tasks: JSON.parse(readString(row, "tasks_json")) as PersistedSessionState["tasks"],
            workflows: JSON.parse(readString(row, "workflows_json")) as PersistedWorkflowRun[],
            workflowsEnabled: readNumber(row, "workflows_enabled") !== 0,
            nextTaskId: readNumber(row, "next_task_id"),
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
            ...(restore.docker === undefined ? {} : { docker: restore.docker }),
            ...(restore.effort !== undefined ? { effort: restore.effort } : {}),
            ...(restore.serviceTier !== undefined ? { serviceTier: restore.serviceTier } : {}),
            ...(restore.instructions !== undefined ? { instructions: restore.instructions } : {}),
            modelId,
            providerId: restore.providerId,
            workflowsEnabled: restore.workflowsEnabled !== false,
        };
        return new InMemorySession({
            agentManager: this.#agentManager,
            createEventId: this.#createEventId,
            events: this.#loadEvents(sessionId),
            modelCatalog: this.#modelCatalog,
            ...(this.#mcpToolProvider !== undefined
                ? { mcpToolProvider: this.#mcpToolProvider }
                : {}),
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

    #ensureQueuedRunColumn(name: string, definition: string): void {
        const columns = this.#database.prepare("PRAGMA table_info(queued_runs)").all();
        if (columns.some((column) => readString(column, "name") === name)) {
            return;
        }
        this.#database.exec(`ALTER TABLE queued_runs ADD COLUMN ${name} ${definition}`);
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
