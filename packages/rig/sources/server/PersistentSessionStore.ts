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
    RegisterSecretRequest,
    SecretSummary,
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
    type InMemorySessionOptions,
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
import type { TaskDrain } from "./TrackedTaskDrain.js";
import { isTransientInferenceSessionEvent } from "./isTransientInferenceSessionEvent.js";
import { SecretRegistry, type SecretRegistration } from "../secrets/index.js";
import type { SecretAttachmentScope } from "../secrets/index.js";
import { normalizeProjectCwd } from "./normalizeProjectCwd.js";
import { initializeSessionDatabase } from "./initializeSessionDatabase.js";
import type { ExternalToolCall, ExternalToolDefinition } from "../external-tools/index.js";
import type { DurableSkillDefinition } from "../external-skills/index.js";
import type { DurableUserInputCall } from "../user-input/index.js";

export interface PersistentSessionStoreOptions {
    createRuntime?: InMemorySessionOptions["createRuntime"];
    databasePath: string;
    durableGlobalEventQueue?: boolean;
    mcpToolProvider?: McpToolProvider;
    modelCatalog?: ModelCatalog;
    now?: () => number;
    onSessionAccess?: (session: InMemorySession) => void;
    onSessionEvent?: (event: SessionEvent, session: InMemorySession | undefined) => void;
    taskDrain?: TaskDrain;
    secrets?: readonly SecretRegistration[];
}

export class PersistentSessionStore implements SessionStore, InMemorySessionPersistence {
    #agentManager: AgentSessionManager;
    #createRuntime: InMemorySessionOptions["createRuntime"];
    #database: DatabaseSync;
    #modelCatalog: ModelCatalog;
    #mcpToolProvider: McpToolProvider | undefined;
    #now: () => number;
    #onSessionAccess: ((session: InMemorySession) => void) | undefined;
    #onSessionEvent:
        | ((event: SessionEvent, session: InMemorySession | undefined) => void)
        | undefined;
    #persistentGlobalEventQueue: PersistentGlobalEventQueue | undefined;
    #secrets: SecretRegistry;
    #sessions = new Map<string, WeakRef<InMemorySession>>();
    #sessionFinalizer = new FinalizationRegistry<{
        id: string;
        reference: WeakRef<InMemorySession>;
    }>(({ id, reference }) => {
        if (this.#sessions.get(id) === reference) this.#sessions.delete(id);
    });
    #taskDrain: TaskDrain | undefined;

    constructor(options: PersistentSessionStoreOptions) {
        this.#secrets = new SecretRegistry();
        this.#modelCatalog = options.modelCatalog ?? createModelCatalog();
        this.#createRuntime = options.createRuntime;
        this.#mcpToolProvider = options.mcpToolProvider;
        this.#now = options.now ?? Date.now;
        this.#onSessionAccess = options.onSessionAccess;
        this.#onSessionEvent = options.onSessionEvent;
        this.#taskDrain = options.taskDrain;
        if (options.databasePath !== ":memory:") {
            mkdirSync(dirname(options.databasePath), { mode: 0o700, recursive: true });
        }
        this.#database = new DatabaseSync(options.databasePath, {
            enableForeignKeyConstraints: true,
            timeout: 5_000,
        });
        if (options.databasePath !== ":memory:") chmodSync(options.databasePath, 0o600);
        initializeSessionDatabase(this.#database);
        this.#loadSecretRegistrations();
        for (const secret of options.secrets ?? []) this.registerSecret(secret);
        if (options.durableGlobalEventQueue === true) {
            this.#persistentGlobalEventQueue = new PersistentGlobalEventQueue(this.#database);
        }
        this.#agentManager = new AgentSessionManager({
            repository: {
                createSubagent: (request, metadata, contextMessages) =>
                    this.#createSession(request, metadata, contextMessages),
                get: (sessionId) => this.get(sessionId),
                listByRoot: (rootSessionId) => this.#listSubagentSessionsByRoot(rootSessionId),
            },
            ...(this.#taskDrain === undefined ? {} : { taskDrain: this.#taskDrain }),
        });
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

    attachSecret(
        sessionId: string,
        secretId: string,
        scope: SecretAttachmentScope,
    ): InMemorySession | undefined {
        const session = this.get(sessionId);
        if (session === undefined) return undefined;
        this.#secrets.reference(secretId);
        if (scope === "project") {
            const cwd = normalizeProjectCwd(session.snapshot().cwd);
            this.#database
                .prepare(
                    "INSERT OR IGNORE INTO project_secret_attachments (cwd, secret_id) VALUES (?, ?)",
                )
                .run(cwd, secretId);
            for (const candidate of this.#cachedSessions()) {
                if (normalizeProjectCwd(candidate.snapshot().cwd) === cwd) {
                    candidate.attachSecret(secretId, { scope });
                }
            }
        } else {
            session.attachSecret(secretId, { scope });
        }
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
        this.#assertAcceptingMutations();
        return this.#createSession(request);
    }

    detachSecret(
        sessionId: string,
        secretId: string,
        scope: SecretAttachmentScope,
    ): InMemorySession | undefined {
        const session = this.get(sessionId);
        if (session === undefined) return undefined;
        if (scope === "project") {
            const cwd = normalizeProjectCwd(session.snapshot().cwd);
            this.#database
                .prepare("DELETE FROM project_secret_attachments WHERE cwd = ? AND secret_id = ?")
                .run(cwd, secretId);
            for (const candidate of this.#cachedSessions()) {
                if (normalizeProjectCwd(candidate.snapshot().cwd) === cwd) {
                    candidate.detachSecret(secretId, { scope });
                }
            }
        } else {
            session.detachSecret(secretId, { scope });
        }
        return session;
    }

    fork(sessionId: string): InMemorySession | undefined {
        this.#assertAcceptingMutations();
        const source = this.get(sessionId);
        if (source === undefined) return undefined;
        const state = source.createForkState();
        const session = new InMemorySession({
            agentManager: this.#agentManager,
            createEventId: createEventIdFactory(),
            ...(this.#createRuntime === undefined ? {} : { createRuntime: this.#createRuntime }),
            emitCreatedEvent: false,
            modelCatalog: this.#modelCatalog,
            ...(this.#mcpToolProvider !== undefined
                ? { mcpToolProvider: this.#mcpToolProvider }
                : {}),
            onAppendEvent: (event) => this.#appendEvent(event),
            persistence: this,
            request: source.requestForSubagent(),
            projectSecretIds: this.#projectSecrets(source.snapshot().cwd),
            secretRegistry: this.#secrets,
            restore: state,
            ...(this.#taskDrain === undefined ? {} : { taskDrain: this.#taskDrain }),
        });
        this.#cacheSession(session);
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
        contextMessages?: readonly Message[],
    ): InMemorySession {
        this.#assertAcceptingMutations();
        const session = new InMemorySession({
            agentManager: this.#agentManager,
            createEventId: createEventIdFactory(),
            ...(this.#createRuntime === undefined ? {} : { createRuntime: this.#createRuntime }),
            emitCreatedEvent: false,
            modelCatalog: this.#modelCatalog,
            ...(this.#mcpToolProvider !== undefined
                ? { mcpToolProvider: this.#mcpToolProvider }
                : {}),
            ...(metadata !== undefined ? { metadata } : {}),
            ...(contextMessages !== undefined ? { initialContextMessages: contextMessages } : {}),
            onAppendEvent: (event) => this.#appendEvent(event),
            persistence: this,
            projectSecretIds: this.#projectSecrets(request.cwd),
            request,
            ...(this.#taskDrain === undefined ? {} : { taskDrain: this.#taskDrain }),
            secretRegistry: this.#secrets,
        });
        this.#cacheSession(session);
        session.emitCreatedEvent();
        return session;
    }

    deleteQueuedRun(sessionId: string, runId: string): void {
        this.#database
            .prepare("DELETE FROM queued_runs WHERE session_id = ? AND run_id = ?")
            .run(sessionId, runId);
    }

    get(sessionId: string): InMemorySession | undefined {
        const existingReference = this.#sessions.get(sessionId);
        const existing = existingReference?.deref();
        if (existing !== undefined) {
            this.#notifySessionAccess(existing);
            return existing;
        }
        if (existingReference !== undefined) this.#sessions.delete(sessionId);

        const session = this.#loadSession(sessionId);
        if (session !== undefined) {
            this.#cacheSession(session);
            this.#notifySessionAccess(session);
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
                    debug,
                    debug_directory,
                    display_text,
                    kind,
                    text,
                    user_message_json,
                    integration_config_json,
                    created_at_ms
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id, run_id) DO UPDATE SET
                    debug = excluded.debug,
                    debug_directory = excluded.debug_directory,
                    display_text = excluded.display_text,
                    kind = excluded.kind,
                    text = excluded.text,
                    user_message_json = excluded.user_message_json,
                    integration_config_json = excluded.integration_config_json
                `,
            )
            .run(
                sessionId,
                run.runId,
                run.debug === true ? 1 : 0,
                run.debugDirectory ?? null,
                run.displayText,
                run.kind,
                run.text,
                JSON.stringify(run.userMessage),
                run.externalTools === undefined &&
                    run.skills === undefined &&
                    run.systemPrompt === undefined
                    ? null
                    : JSON.stringify({
                          ...(run.externalTools === undefined
                              ? {}
                              : { externalTools: run.externalTools }),
                          ...(run.skills === undefined ? {} : { skills: run.skills }),
                          ...(run.systemPrompt === undefined
                              ? {}
                              : { systemPrompt: run.systemPrompt }),
                      }),
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
                    secret_ids_json,
                    provider_id,
                    model_id,
                    permission_mode,
                    effort,
                    service_tier,
                    status,
                    title,
                    title_status,
                    title_error,
                    recap,
                    metadata_updated_at_ms,
                    metadata_run_id,
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
            const recap = readOptionalString(row, "recap");
            const metadataUpdatedAt = readOptionalNumber(row, "metadata_updated_at_ms");
            const metadataRunId = readOptionalString(row, "metadata_run_id");
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
                ...(recap !== undefined ? { recap } : {}),
                ...(metadataUpdatedAt !== undefined ? { metadataUpdatedAt } : {}),
                ...(metadataRunId !== undefined ? { metadataRunId } : {}),
                ...(interruptionJson !== undefined
                    ? { interruption: JSON.parse(interruptionJson) as SessionInterruption }
                    : {}),
            };
        });
    }

    loadedSessions(): readonly InMemorySession[] {
        return this.#cachedSessions();
    }

    listExternalToolCalls(
        options: { limit?: number; status?: ExternalToolCall["status"] } = {},
    ): readonly ExternalToolCall[] {
        const rows =
            options.status === undefined
                ? this.#database
                      .prepare(
                          "SELECT * FROM external_tool_calls ORDER BY created_at_ms ASC, tool_call_index ASC LIMIT ?",
                      )
                      .all(options.limit ?? 100)
                : this.#database
                      .prepare(
                          "SELECT * FROM external_tool_calls WHERE status = ? ORDER BY created_at_ms ASC, tool_call_index ASC LIMIT ?",
                      )
                      .all(options.status, options.limit ?? 100);
        return rows.map(readExternalToolCallRow);
    }

    listSubagents(parentSessionId: string): readonly SubagentSummary[] {
        return this.#database
            .prepare(
                `
                WITH RECURSIVE descendants(id) AS (
                    SELECT id
                    FROM sessions
                    WHERE parent_session_id = ?
                    UNION ALL
                    SELECT sessions.id
                    FROM sessions
                    JOIN descendants ON sessions.parent_session_id = descendants.id
                )
                SELECT
                    id,
                    agent_id,
                    model_id,
                    status,
                    active_since_ms,
                    elapsed_ms,
                    total_tokens,
                    parent_session_id,
                    parent_tool_call_id,
                    task_name,
                    depth,
                    description,
                    created_at_ms,
                    updated_at_ms
                FROM sessions
                WHERE id IN descendants
                ORDER BY created_at_ms ASC
                `,
            )
            .all(parentSessionId)
            .map((row) => {
                const parentToolCallId = readOptionalString(row, "parent_tool_call_id");
                const taskName = readOptionalString(row, "task_name");
                const activeSince = readOptionalNumber(row, "active_since_ms");
                return {
                    ...(activeSince === undefined ? {} : { activeSince }),
                    agentId: readString(row, "agent_id"),
                    createdAt: readNumber(row, "created_at_ms"),
                    depth: readNumber(row, "depth"),
                    description: readOptionalString(row, "description") ?? "Delegated task",
                    elapsedMs: readNumber(row, "elapsed_ms"),
                    id: readString(row, "id"),
                    modelId: readString(row, "model_id"),
                    parentSessionId: readString(row, "parent_session_id"),
                    ...(parentToolCallId !== undefined ? { parentToolCallId } : {}),
                    status: readString(row, "status") as SubagentSummary["status"],
                    ...(taskName !== undefined ? { taskName } : {}),
                    totalTokens: readNumber(row, "total_tokens"),
                    updatedAt: readNumber(row, "updated_at_ms"),
                };
            });
    }

    listSecrets(): readonly SecretSummary[] {
        return this.#secrets.references();
    }

    registerSecret(request: RegisterSecretRequest): SecretSummary {
        const candidate = new SecretRegistry([request]);
        this.#transaction(() => {
            this.#database
                .prepare(
                    `
                    INSERT INTO secret_registrations (id, description, environment_json)
                    VALUES (?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        description = excluded.description,
                        environment_json = excluded.environment_json
                    `,
                )
                .run(request.id, request.description.trim(), JSON.stringify(request.environment));
            const rememberEnvironmentVariable = this.#database.prepare(
                `
                INSERT INTO secret_environment_variables (secret_id, normalized_name, name)
                VALUES (?, ?, ?)
                ON CONFLICT(secret_id, normalized_name) DO UPDATE SET name = excluded.name
                `,
            );
            for (const name of Object.keys(request.environment)) {
                rememberEnvironmentVariable.run(request.id, name.toUpperCase(), name);
            }
        });
        this.#secrets.register(request);
        return candidate.reference(request.id);
    }

    unregisterSecret(secretId: string): boolean {
        if (!this.#secrets.references().some((secret) => secret.id === secretId)) return false;
        const rows = this.#database.prepare("SELECT id, secret_ids_json FROM sessions").all();
        const update = this.#database.prepare(
            "UPDATE sessions SET secret_ids_json = ? WHERE id = ?",
        );
        this.#transaction(() => {
            this.#database.prepare("DELETE FROM secret_registrations WHERE id = ?").run(secretId);
            for (const row of rows) {
                const ids = JSON.parse(readString(row, "secret_ids_json")) as string[];
                update.run(
                    JSON.stringify(ids.filter((id) => id !== secretId)),
                    readString(row, "id"),
                );
            }
            this.#database
                .prepare("DELETE FROM project_secret_attachments WHERE secret_id = ?")
                .run(secretId);
        });
        this.#secrets.unregister(secretId);
        for (const session of this.#cachedSessions()) {
            session.detachSecret(secretId, { scope: "project" });
            session.detachSecret(secretId, { scope: "session" });
        }
        return true;
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
                SELECT DISTINCT sessions.id, sessions.active_run_id
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
            const activeRunId = readOptionalString(row, "active_run_id");
            if (
                activeRunId !== undefined &&
                this.#reconcileTerminalRunState(sessionId, activeRunId)
            ) {
                continue;
            }
            const session = this.get(sessionId);
            if (session === undefined) {
                continue;
            }

            const state = session.state();
            const runId = state.activeRunId ?? state.queuedRuns.at(0)?.runId;
            if (session.hasDurableToolRun()) {
                session.resumeDurableToolRun();
                continue;
            }
            if (session.isSubagent() && state.status === "suspended") {
                const message =
                    "The subagent stopped working because the local server restarted before its suspended run finished.";
                session.markSuspendedAfterRestart(message, runId);
                const parentSessionId = session.agentMetadata().parentSessionId;
                const parent =
                    parentSessionId === undefined ? undefined : this.get(parentSessionId);
                this.#agentManager.recordChanged(session);
                parent?.recordSubagentStoppedAfterRestart(session.subagentSummary());
                continue;
            }
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
                this.#agentManager.recordChanged(session);
            }
        }
    }

    #reconcileTerminalRunState(sessionId: string, runId: string): boolean {
        const row = this.#database
            .prepare(
                `
                SELECT type, data_json
                FROM session_events
                WHERE session_id = ?
                    AND type IN ('run_finished', 'run_error')
                    AND json_extract(data_json, '$.runId') = ?
                ORDER BY seq DESC
                LIMIT 1
                `,
            )
            .get(sessionId, runId);
        if (row === undefined) return false;

        const type = readString(row, "type");
        const data = JSON.parse(readString(row, "data_json")) as { stopReason?: string };
        const status =
            type === "run_error"
                ? "error"
                : data.stopReason === "aborted"
                  ? "aborted"
                  : "completed";
        this.#transaction(() => {
            this.#database
                .prepare(
                    `
                    UPDATE sessions
                    SET
                        status = ?,
                        active_run_id = NULL,
                        active_since_ms = NULL,
                        interrupted = 0,
                        interruption_json = NULL,
                        last_event_id = (
                            SELECT event_id
                            FROM session_events
                            WHERE session_id = ?
                            ORDER BY seq DESC
                            LIMIT 1
                        ),
                        updated_at_ms = ?
                    WHERE id = ?
                    `,
                )
                .run(status, sessionId, this.#now(), sessionId);
            this.#database
                .prepare("DELETE FROM queued_runs WHERE session_id = ? AND run_id = ?")
                .run(sessionId, runId);
        });
        return true;
    }

    async prepareForShutdown(reason: SessionInterruption["reason"]): Promise<void> {
        this.#taskDrain?.beginClose();
        const closingSessions = new Set(this.#cachedSessions());
        const cleanup = [...closingSessions].map((session) => session.beginShutdown());
        let repairError: unknown;
        try {
            this.repairInterruptedSessions(reason);
        } catch (error) {
            repairError = error;
        }
        for (const session of this.#cachedSessions()) {
            if (closingSessions.has(session)) continue;
            cleanup.push(session.beginShutdown());
        }
        const cleanupResults = await Promise.allSettled(cleanup);
        await this.#taskDrain?.drain();
        const cleanupErrors = cleanupResults
            .filter((result): result is PromiseRejectedResult => result.status === "rejected")
            .map((result) => result.reason);
        if (repairError !== undefined || cleanupErrors.length > 0) {
            throw new AggregateError(
                [...(repairError === undefined ? [] : [repairError]), ...cleanupErrors],
                "The local daemon could not finish session cleanup.",
            );
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
                    secret_ids_json,
                    provider_id,
                    model_id,
                    effort,
                    service_tier,
                    instructions,
                    append_system_prompt,
                    system_prompt,
                    external_tools_json,
                    durable_skills_json,
                    status,
                    active_run_id,
                    active_since_ms,
                    elapsed_ms,
                    total_tokens,
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
                    recap,
                    metadata_updated_at_ms,
                    metadata_run_id,
                    interrupted,
                    interruption_json,
                    last_message_at_ms,
                    created_at_ms,
                    updated_at_ms
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    secret_ids_json = excluded.secret_ids_json,
                    provider_id = excluded.provider_id,
                    model_id = excluded.model_id,
                    effort = excluded.effort,
                    service_tier = excluded.service_tier,
                    instructions = excluded.instructions,
                    append_system_prompt = excluded.append_system_prompt,
                    system_prompt = excluded.system_prompt,
                    external_tools_json = excluded.external_tools_json,
                    durable_skills_json = excluded.durable_skills_json,
                    status = excluded.status,
                    active_run_id = excluded.active_run_id,
                    active_since_ms = excluded.active_since_ms,
                    elapsed_ms = excluded.elapsed_ms,
                    total_tokens = excluded.total_tokens,
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
                    recap = excluded.recap,
                    metadata_updated_at_ms = excluded.metadata_updated_at_ms,
                    metadata_run_id = excluded.metadata_run_id,
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
                JSON.stringify(state.secretIds ?? []),
                state.providerId,
                state.modelId,
                state.effort ?? null,
                state.serviceTier ?? null,
                state.instructions ?? null,
                state.appendSystemPrompt ?? null,
                state.systemPrompt ?? null,
                JSON.stringify(state.externalTools ?? []),
                JSON.stringify(state.skills ?? []),
                state.status,
                state.activeRunId ?? null,
                state.activeSince ?? null,
                state.elapsedMs ?? 0,
                state.totalTokens ?? 0,
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
                state.recap ?? null,
                state.metadataUpdatedAt ?? null,
                state.metadataRunId ?? null,
                state.interruption === undefined ? 0 : 1,
                state.interruption === undefined ? null : JSON.stringify(state.interruption),
                state.lastMessageAt ?? null,
                this.#now(),
                this.#now(),
            );
    }

    #assertAcceptingMutations(): void {
        if (this.#taskDrain?.closing === true) {
            throw new Error("The local daemon is shutting down.");
        }
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

    upsertExternalToolCall(call: ExternalToolCall): void {
        this.#database
            .prepare(
                `
                INSERT INTO external_tool_calls (
                    id,
                    session_id,
                    run_id,
                    batch_id,
                    tool_call_id,
                    tool_call_index,
                    definition_json,
                    skill_json,
                    arguments_json,
                    status,
                    resolution_json,
                    consumed,
                    created_at_ms,
                    resolved_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    status = excluded.status,
                    resolution_json = excluded.resolution_json,
                    consumed = excluded.consumed,
                    resolved_at_ms = excluded.resolved_at_ms
                `,
            )
            .run(
                call.id,
                call.sessionId,
                call.runId,
                call.batchId,
                call.toolCallId,
                call.toolCallIndex,
                JSON.stringify(call.definition),
                call.skill === undefined ? null : JSON.stringify(call.skill),
                JSON.stringify(call.arguments),
                call.status,
                call.resolution === undefined ? null : JSON.stringify(call.resolution),
                call.consumed ? 1 : 0,
                call.createdAt,
                call.resolvedAt ?? null,
            );
    }

    handoffDurablePermissionToExternalTool(
        externalCall: ExternalToolCall,
        permissionCall: DurableUserInputCall,
    ): void {
        this.#database.exec("BEGIN IMMEDIATE");
        try {
            this.upsertExternalToolCall(externalCall);
            this.upsertDurableUserInput(permissionCall);
            this.#database.exec("COMMIT");
        } catch (error) {
            this.#database.exec("ROLLBACK");
            throw error;
        }
    }

    upsertDurableUserInput(call: DurableUserInputCall): void {
        this.#database
            .prepare(
                `
                INSERT INTO durable_user_inputs (
                    session_id,
                    request_id,
                    run_id,
                    batch_id,
                    tool_call_id,
                    tool_call_index,
                    tool_name,
                    tool_arguments_json,
                    kind,
                    permission_json,
                    request_json,
                    response_json,
                    result_json,
                    status,
                    consumed,
                    created_at_ms,
                    resolved_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id, request_id) DO UPDATE SET
                    response_json = excluded.response_json,
                    result_json = excluded.result_json,
                    status = excluded.status,
                    consumed = excluded.consumed,
                    resolved_at_ms = excluded.resolved_at_ms
                `,
            )
            .run(
                call.sessionId,
                call.request.requestId,
                call.runId,
                call.batchId,
                call.toolCallId,
                call.toolCallIndex,
                call.toolName,
                JSON.stringify(call.toolArguments),
                call.kind,
                call.permission === undefined ? null : JSON.stringify(call.permission),
                JSON.stringify(call.request),
                call.response === undefined ? null : JSON.stringify(call.response),
                call.result === undefined ? null : JSON.stringify(call.result),
                call.status,
                call.consumed ? 1 : 0,
                call.createdAt,
                call.resolvedAt ?? null,
            );
    }

    pruneExternalToolCalls(sessionId: string, retain: number): void {
        this.#database
            .prepare(
                `
                DELETE FROM external_tool_calls
                WHERE session_id = ?
                    AND (status = 'cancelled' OR consumed = 1)
                    AND id NOT IN (
                        SELECT id
                        FROM external_tool_calls
                        WHERE session_id = ?
                            AND (status = 'cancelled' OR consumed = 1)
                        ORDER BY COALESCE(resolved_at_ms, created_at_ms) DESC,
                            tool_call_index DESC
                        LIMIT ?
                    )
                `,
            )
            .run(sessionId, sessionId, retain);
    }

    pruneDurableUserInputs(sessionId: string, retain: number): void {
        this.#database
            .prepare(
                `
                DELETE FROM durable_user_inputs
                WHERE session_id = ?
                    AND (status = 'cancelled' OR consumed = 1)
                    AND request_id NOT IN (
                        SELECT request_id
                        FROM durable_user_inputs
                        WHERE session_id = ?
                            AND (status = 'cancelled' OR consumed = 1)
                        ORDER BY COALESCE(resolved_at_ms, created_at_ms) DESC,
                            tool_call_index DESC
                        LIMIT ?
                    )
                `,
            )
            .run(sessionId, sessionId, retain);
    }

    #appendEvent(event: SessionEvent): void {
        if (isTransientInferenceSessionEvent(event)) {
            this.#database
                .prepare(
                    `
                    UPDATE sessions
                    SET last_event_id = ?, updated_at_ms = ?
                    WHERE id = ?
                    `,
                )
                .run(event.id, this.#now(), event.sessionId);
            this.#notifySessionEvent(event);
            return;
        }
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
        this.#notifySessionEvent(event);
    }

    #notifySessionAccess(session: InMemorySession): void {
        try {
            this.#onSessionAccess?.(session);
        } catch {
            // External synchronization must never interrupt local session access.
        }
    }

    #notifySessionEvent(event: SessionEvent): void {
        try {
            this.#onSessionEvent?.(event, this.#sessions.get(event.sessionId)?.deref());
        } catch {
            // The event is already durable; optional observers cannot roll it back.
        }
    }

    #loadSecretRegistrations(): void {
        const rows = this.#database
            .prepare("SELECT id, description, environment_json FROM secret_registrations")
            .all();
        for (const row of rows) {
            this.#secrets.register({
                description: readString(row, "description"),
                environment: JSON.parse(readString(row, "environment_json")) as Readonly<
                    Record<string, string>
                >,
                id: readString(row, "id"),
            });
        }
        const rememberEnvironmentVariable = this.#database.prepare(
            `
            INSERT OR IGNORE INTO secret_environment_variables (secret_id, normalized_name, name)
            VALUES (?, ?, ?)
            `,
        );
        for (const secret of this.#secrets.references()) {
            for (const name of secret.environmentVariables) {
                rememberEnvironmentVariable.run(secret.id, name.toUpperCase(), name);
            }
        }
        const environmentRows = this.#database
            .prepare("SELECT secret_id, name FROM secret_environment_variables")
            .all();
        for (const row of environmentRows) {
            this.#secrets.rememberEnvironmentVariables(readString(row, "secret_id"), [
                readString(row, "name"),
            ]);
        }
    }

    #loadEvents(sessionId: string): SessionEvent[] {
        const rows = this.#database
            .prepare(
                `
                SELECT event_id, type, created_at_ms, data_json
                FROM session_events
                WHERE session_id = ?
                ORDER BY seq ASC
                `,
            )
            .iterate(sessionId);
        const events: SessionEvent[] = [];
        for (const row of rows) {
            const event = {
                createdAt: readNumber(row, "created_at_ms"),
                data: JSON.parse(readString(row, "data_json")) as SessionEvent["data"],
                id: readString(row, "event_id"),
                sessionId,
                type: readString(row, "type") as SessionEvent["type"],
            } as SessionEvent;
            events.push(event);
        }
        return events;
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
                SELECT run_id, debug, debug_directory, display_text, kind, text, user_message_json,
                    integration_config_json
                FROM queued_runs
                WHERE session_id = ?
                ORDER BY created_at_ms ASC
                `,
            )
            .all(sessionId)
            .map((row) => {
                const debugDirectory = readOptionalString(row, "debug_directory");
                const integrationConfigJson = readOptionalString(row, "integration_config_json");
                const integrationConfig =
                    integrationConfigJson === undefined
                        ? {}
                        : (JSON.parse(integrationConfigJson) as {
                              externalTools?: readonly ExternalToolDefinition[];
                              skills?: readonly DurableSkillDefinition[];
                              systemPrompt?: string | null;
                          });
                return {
                    ...(readNumber(row, "debug") === 0 ? {} : { debug: true }),
                    ...(debugDirectory === undefined ? {} : { debugDirectory }),
                    displayText: readString(row, "display_text"),
                    kind: readString(row, "kind") as PersistedQueuedRun["kind"],
                    runId: readString(row, "run_id"),
                    text: readString(row, "text"),
                    userMessage: JSON.parse(readString(row, "user_message_json")),
                    ...integrationConfig,
                };
            }) as PersistedQueuedRun[];
    }

    #loadExternalToolCalls(sessionId: string): ExternalToolCall[] {
        return this.#database
            .prepare(
                `
                SELECT *
                FROM external_tool_calls
                WHERE session_id = ?
                ORDER BY created_at_ms ASC, tool_call_index ASC
                `,
            )
            .all(sessionId)
            .map(readExternalToolCallRow);
    }

    #loadDurableUserInputs(sessionId: string): DurableUserInputCall[] {
        return this.#database
            .prepare(
                `
                SELECT *
                FROM durable_user_inputs
                WHERE session_id = ?
                ORDER BY created_at_ms ASC, tool_call_index ASC
                `,
            )
            .all(sessionId)
            .map((row) => {
                const permissionJson = readOptionalString(row, "permission_json");
                const responseJson = readOptionalString(row, "response_json");
                const resultJson = readOptionalString(row, "result_json");
                const resolvedAt = readOptionalNumber(row, "resolved_at_ms");
                return {
                    batchId: readString(row, "batch_id"),
                    consumed: readNumber(row, "consumed") !== 0,
                    createdAt: readNumber(row, "created_at_ms"),
                    kind: readString(row, "kind") as DurableUserInputCall["kind"],
                    ...(permissionJson === undefined
                        ? {}
                        : { permission: JSON.parse(permissionJson) }),
                    request: JSON.parse(readString(row, "request_json")),
                    ...(responseJson === undefined ? {} : { response: JSON.parse(responseJson) }),
                    ...(resolvedAt === undefined ? {} : { resolvedAt }),
                    ...(resultJson === undefined ? {} : { result: JSON.parse(resultJson) }),
                    runId: readString(row, "run_id"),
                    sessionId: readString(row, "session_id"),
                    status: readString(row, "status") as DurableUserInputCall["status"],
                    toolArguments: JSON.parse(readString(row, "tool_arguments_json")),
                    toolCallId: readString(row, "tool_call_id"),
                    toolCallIndex: readNumber(row, "tool_call_index"),
                    toolName: readString(row, "tool_name"),
                };
            });
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
        const secretIdsJson = readOptionalString(row, "secret_ids_json");
        const instructions = readOptionalString(row, "instructions");
        const appendSystemPrompt = readOptionalString(row, "append_system_prompt");
        const systemPrompt = readOptionalString(row, "system_prompt");
        const interruptionJson = readOptionalString(row, "interruption_json");
        const lastMessageAt = readOptionalNumber(row, "last_message_at_ms");
        const modelId = readString(row, "model_id");
        const title = readOptionalString(row, "title");
        const titleError = readOptionalString(row, "title_error");
        const recap = readOptionalString(row, "recap");
        const metadataUpdatedAt = readOptionalNumber(row, "metadata_updated_at_ms");
        const metadataRunId = readOptionalString(row, "metadata_run_id");
        const activeRunId = readOptionalString(row, "active_run_id");
        const activeSince = readOptionalNumber(row, "active_since_ms");
        const contextMessagesJson = readOptionalString(row, "context_messages_json");
        const permissionMode = parsePermissionMode(readString(row, "permission_mode"));
        const parentSessionId = readOptionalString(row, "parent_session_id");
        const parentToolCallId = readOptionalString(row, "parent_tool_call_id");
        const taskName = readOptionalString(row, "task_name");
        const description = readOptionalString(row, "description");
        const goalJson = readOptionalString(row, "goal_json");
        const lastEventId = readOptionalString(row, "last_event_id");
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
            ...(activeSince !== undefined ? { activeSince } : {}),
            agent,
            agentId: readString(row, "agent_id"),
            ...(appendSystemPrompt !== undefined ? { appendSystemPrompt } : {}),
            ...(systemPrompt !== undefined ? { systemPrompt } : {}),
            cwd: readString(row, "cwd"),
            elapsedMs: readNumber(row, "elapsed_ms"),
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
            durableUserInputs: this.#loadDurableUserInputs(sessionId),
            externalToolCalls: this.#loadExternalToolCalls(sessionId),
            externalTools: JSON.parse(
                readString(row, "external_tools_json"),
            ) as ExternalToolDefinition[],
            skills: JSON.parse(readString(row, "durable_skills_json")) as DurableSkillDefinition[],
            modelId,
            models: JSON.parse(readString(row, "models_json")) as Model[],
            providerId: readString(row, "provider_id"),
            permissionMode,
            secretIds: secretIdsJson === undefined ? [] : (JSON.parse(secretIdsJson) as string[]),
            queuedRuns: this.#loadQueuedRuns(sessionId),
            status: readString(row, "status") as PersistedSessionState["status"],
            tasks: JSON.parse(readString(row, "tasks_json")) as PersistedSessionState["tasks"],
            workflows: JSON.parse(readString(row, "workflows_json")) as PersistedWorkflowRun[],
            workflowsEnabled: readNumber(row, "workflows_enabled") !== 0,
            nextTaskId: readNumber(row, "next_task_id"),
            ...(title !== undefined ? { title } : {}),
            ...(titleError !== undefined ? { titleError } : {}),
            ...(recap !== undefined ? { recap } : {}),
            ...(metadataUpdatedAt !== undefined ? { metadataUpdatedAt } : {}),
            ...(metadataRunId !== undefined ? { metadataRunId } : {}),
            titleStatus: readString(row, "title_status") as SessionTitleStatus,
            totalTokens: readNumber(row, "total_tokens"),
            tools: JSON.parse(readString(row, "tools_json")) as string[],
        };
        if (activeRunId !== undefined) {
            restore.activeRunId = activeRunId;
        }

        const request: CreateSessionRequest = {
            ...(restore.appendSystemPrompt !== undefined
                ? { appendSystemPrompt: restore.appendSystemPrompt }
                : {}),
            cwd: restore.cwd,
            ...(restore.docker === undefined ? {} : { docker: restore.docker }),
            ...(restore.effort !== undefined ? { effort: restore.effort } : {}),
            ...(restore.serviceTier !== undefined ? { serviceTier: restore.serviceTier } : {}),
            ...(restore.instructions !== undefined ? { instructions: restore.instructions } : {}),
            modelId,
            providerId: restore.providerId,
            secretIds: restore.secretIds ?? [],
            workflowsEnabled: restore.workflowsEnabled !== false,
        };
        return new InMemorySession({
            agentManager: this.#agentManager,
            createEventId: createEventIdFactory(
                lastEventId === undefined ? {} : { after: lastEventId },
            ),
            ...(this.#createRuntime === undefined ? {} : { createRuntime: this.#createRuntime }),
            events: this.#loadEvents(sessionId),
            ...(lastEventId !== undefined ? { lastEventId } : {}),
            modelCatalog: this.#modelCatalog,
            ...(this.#mcpToolProvider !== undefined
                ? { mcpToolProvider: this.#mcpToolProvider }
                : {}),
            onAppendEvent: (event) => this.#appendEvent(event),
            persistence: this,
            projectSecretIds: this.#projectSecrets(restore.cwd),
            request,
            secretRegistry: this.#secrets,
            restore,
            ...(this.#taskDrain === undefined ? {} : { taskDrain: this.#taskDrain }),
        });
    }

    #cacheSession(session: InMemorySession): void {
        const previous = this.#sessions.get(session.id);
        if (previous !== undefined) this.#sessionFinalizer.unregister(previous);
        const reference = new WeakRef(session);
        this.#sessions.set(session.id, reference);
        this.#sessionFinalizer.register(session, { id: session.id, reference }, reference);
    }

    #cachedSessions(): InMemorySession[] {
        const sessions: InMemorySession[] = [];
        for (const [id, reference] of this.#sessions) {
            const session = reference.deref();
            if (session === undefined) {
                this.#sessions.delete(id);
                this.#sessionFinalizer.unregister(reference);
                continue;
            }
            sessions.push(session);
        }
        return sessions;
    }

    #projectSecrets(cwd: string): readonly string[] {
        return this.#database
            .prepare(
                "SELECT secret_id FROM project_secret_attachments WHERE cwd = ? ORDER BY secret_id",
            )
            .all(normalizeProjectCwd(cwd))
            .map((row) => readString(row, "secret_id"));
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

function readExternalToolCallRow(row: Record<string, unknown>): ExternalToolCall {
    const resolutionJson = readOptionalString(row, "resolution_json");
    const skillJson = readOptionalString(row, "skill_json");
    const resolvedAt = readOptionalNumber(row, "resolved_at_ms");
    return {
        arguments: JSON.parse(readString(row, "arguments_json")),
        batchId: readString(row, "batch_id"),
        consumed: readNumber(row, "consumed") !== 0,
        createdAt: readNumber(row, "created_at_ms"),
        definition: JSON.parse(readString(row, "definition_json")) as ExternalToolDefinition,
        ...(skillJson === undefined
            ? {}
            : { skill: JSON.parse(skillJson) as DurableSkillDefinition }),
        id: readString(row, "id"),
        runId: readString(row, "run_id"),
        sessionId: readString(row, "session_id"),
        status: readString(row, "status") as ExternalToolCall["status"],
        toolCallId: readString(row, "tool_call_id"),
        toolCallIndex: readNumber(row, "tool_call_index"),
        ...(resolutionJson === undefined ? {} : { resolution: JSON.parse(resolutionJson) }),
        ...(resolvedAt === undefined ? {} : { resolvedAt }),
    };
}
