import { createId } from "@paralleldrive/cuid2";

import { assistantMessageToAgentMessage } from "../agent/assistantMessageToAgentMessage.js";
import type {
    AgentLoopEvent,
    AgentCompactionResult,
    AgentRunResult,
    AgentSnapshot,
    ContentBlock,
} from "../agent/index.js";
import type { Message, UserMessage } from "../agent/types.js";
import {
    createGoalContinuationPrompt,
    normalizeGoalObjective,
    type ChangeGoalStatusRequest,
    type CreateGoalRequest,
    type SessionGoal,
} from "../goals/index.js";
import type { CodingAssistantRuntime } from "../app/CodingAssistantRuntime.js";
import {
    createCodingAssistantAgent,
    type CreateCodingAssistantAgentOptions,
} from "../app/createCodingAssistantAgent.js";
import type {
    ChangeEffortRequest,
    ChangeModelRequest,
    ChangePermissionModeRequest,
    CreateSessionRequest,
    EventId,
    ModelCatalog,
    ProtocolSession,
    SessionEvent,
    SessionAgentMetadata,
    SessionInterruption,
    SessionStatus,
    SessionSummary,
    SubagentSummary,
    SessionTitleStatus,
    SubmitMessageRequest,
    SubmitMessageResponse,
    SteerMessageResponse,
} from "../protocol/index.js";
import type { Model, StopReason } from "../providers/types.js";
import type { UserInputRequest, UserInputResponse } from "../user-input/index.js";
import { createCodeReviewPrompt } from "../review/index.js";
import { mergeMcpTools, type McpServerSummary, type McpToolProvider } from "../mcp/index.js";
import type {
    CreateTaskRequest,
    SessionTask,
    UpdateTaskRequest,
    UpdateTaskResult,
} from "../tasks/index.js";
import {
    DEFAULT_PERMISSION_MODE,
    parsePermissionMode,
    type PermissionMode,
} from "../permissions/index.js";
import { generateSessionTitle } from "./generateSessionTitle.js";
import { createGoalTitle } from "./createGoalTitle.js";
import { getProviderIdForModel } from "./getProviderIdForModel.js";
import { resolveInitialModelSelection } from "./resolveInitialModelSelection.js";
import { SessionEventLog } from "./SessionEventLog.js";
import type { AgentSessionManager } from "./AgentSessionManager.js";

export interface PersistedSessionMessage {
    isPartial: boolean;
    message: Message;
    position: number;
    runId?: string;
}

export interface PersistedQueuedRun {
    displayText: string;
    kind: "goal" | "user";
    runId: string;
    text: string;
    userMessage: UserMessage;
}

export interface PersistedSessionState {
    activeRunId?: string;
    agent: SessionAgentMetadata;
    agentId: string;
    cwd: string;
    contextMessages?: readonly Message[];
    effort?: string;
    id: string;
    instructions?: string;
    goal?: SessionGoal;
    interruption?: SessionInterruption;
    lastMessageAt?: number;
    messages: readonly PersistedSessionMessage[];
    modelId: string;
    models: readonly Model[];
    providerId: string;
    permissionMode: PermissionMode;
    queuedRuns: readonly PersistedQueuedRun[];
    nextTaskId: number;
    status: SessionStatus;
    tasks: readonly SessionTask[];
    title?: string;
    titleError?: string;
    titleStatus: SessionTitleStatus;
    tools: readonly string[];
}

export interface InMemorySessionPersistence {
    clearMessages(sessionId: string): void;
    deleteQueuedRun(sessionId: string, runId: string): void;
    insertQueuedRun(sessionId: string, run: PersistedQueuedRun): void;
    saveSession(state: PersistedSessionState): void;
    upsertMessage(sessionId: string, message: PersistedSessionMessage): void;
}

export interface InMemorySessionOptions {
    agentManager?: AgentSessionManager;
    createEventId: () => EventId;
    createRuntime?: (options: CreateCodingAssistantAgentOptions) => CodingAssistantRuntime;
    emitCreatedEvent?: boolean;
    events?: readonly SessionEvent[];
    now?: () => number;
    modelCatalog: ModelCatalog;
    metadata?: SessionAgentMetadata;
    mcpToolProvider?: McpToolProvider;
    onAppendEvent?: (event: SessionEvent) => void;
    persistence?: InMemorySessionPersistence;
    request: CreateSessionRequest;
    restore?: PersistedSessionState;
}

interface ActiveRun {
    controller: AbortController;
    kind: PersistedQueuedRun["kind"];
    runId: string;
}

interface PendingUserInput {
    onAbort?: () => void;
    request: UserInputRequest;
    resolve: (response: UserInputResponse) => void;
    signal?: AbortSignal;
}

interface PartialMessageState {
    fallbackId: string;
    position: number | undefined;
    runId: string;
}

export interface SessionRunCompletion {
    errorMessage?: string;
    status: "aborted" | "completed" | "error";
}

export class InMemorySession {
    readonly events: SessionEventLog;
    readonly id: string;

    #activePartial: PartialMessageState | undefined;
    #activeRun: ActiveRun | undefined;
    #agentManager: AgentSessionManager | undefined;
    #agentMetadata: SessionAgentMetadata;
    #agentId: string;
    #createEventId: () => EventId;
    #createRuntime: (options: CreateCodingAssistantAgentOptions) => CodingAssistantRuntime;
    #contextMessages: Message[] | undefined;
    #draining: Promise<void> | undefined;
    #effort: string | undefined;
    #goal: SessionGoal | undefined;
    #instructions: string | undefined;
    #interruption: SessionInterruption | undefined;
    #lastMessageAt: number | undefined;
    #lastSessionRunId: string | undefined;
    #messages: PersistedSessionMessage[] = [];
    #mcpLoaded = false;
    #mcpServers: readonly McpServerSummary[] = [];
    #mcpToolProvider: McpToolProvider | undefined;
    #modelCatalog: ModelCatalog;
    #modelId: string;
    #models: readonly Model[];
    #nextTaskId = 1;
    #now: () => number;
    #partialPositions = new Set<number>();
    #pendingUserInputs = new Map<string, PendingUserInput>();
    #persistence: InMemorySessionPersistence | undefined;
    #providerId: string;
    #permissionMode: PermissionMode;
    #queue: PersistedQueuedRun[] = [];
    #request: CreateSessionRequest;
    #restoredActiveRunId: string | undefined;
    #runtime: CodingAssistantRuntime | undefined;
    #status: SessionStatus = "idle";
    #tasks: SessionTask[] = [];
    #title: string | undefined;
    #titleError: string | undefined;
    #titleStatus: SessionTitleStatus = "idle";
    #tools: readonly string[] = [];

    constructor(options: InMemorySessionOptions) {
        this.#agentManager = options.agentManager;
        this.#createEventId = options.createEventId;
        this.#createRuntime = options.createRuntime ?? createCodingAssistantAgent;
        this.#now = options.now ?? Date.now;
        this.#mcpToolProvider = options.mcpToolProvider;
        this.#modelCatalog = options.modelCatalog;
        this.#persistence = options.persistence;
        this.#request = { ...options.request };
        this.id = options.restore?.id ?? createId();
        this.#agentMetadata = options.restore?.agent ??
            options.metadata ?? {
                depth: 0,
                rootSessionId: this.id,
                type: "primary",
            };
        this.#agentId = options.restore?.agentId ?? createId();
        const requestedModelId =
            options.restore?.modelId ??
            options.request.modelId ??
            this.#modelCatalog.defaultModelId;
        const requestedProviderId =
            options.restore?.providerId ??
            options.request.providerId ??
            this.#modelCatalog.defaultProviderId;
        const selection = resolveInitialModelSelection(
            this.#modelCatalog,
            requestedModelId,
            requestedProviderId,
        );
        this.#modelId = selection.model.id;
        this.#providerId = selection.providerId;
        this.#permissionMode = parsePermissionMode(
            options.restore?.permissionMode ??
                options.request.permissionMode ??
                DEFAULT_PERMISSION_MODE,
        );
        const requestedEffort = options.restore?.effort ?? options.request.effort;
        this.#effort =
            requestedEffort !== undefined &&
            selection.model.thinkingLevels.includes(requestedEffort)
                ? requestedEffort
                : selection.model.defaultThinkingLevel;
        this.#instructions = options.restore?.instructions ?? options.request.instructions;
        this.#goal = options.restore?.goal === undefined ? undefined : { ...options.restore.goal };
        this.#contextMessages =
            options.restore?.contextMessages === undefined
                ? undefined
                : [...options.restore.contextMessages];
        this.#models = this.#modelsForProvider(this.#providerId);
        this.#status = options.restore?.status ?? "idle";
        this.#lastMessageAt = options.restore?.lastMessageAt;
        this.#restoredActiveRunId = options.restore?.activeRunId;
        this.#lastSessionRunId = options.restore?.activeRunId;
        this.#title = options.restore?.title ?? this.#agentMetadata.description;
        this.#titleError = options.restore?.titleError;
        this.#titleStatus =
            options.restore?.titleStatus ??
            (this.#agentMetadata.description !== undefined ? "ready" : "idle");
        this.#tasks =
            options.restore?.tasks === undefined ? [] : options.restore.tasks.map(cloneTask);
        this.#nextTaskId = options.restore?.nextTaskId ?? nextTaskId(this.#tasks);
        this.#tools = options.restore?.tools ?? [];
        this.#interruption = options.restore?.interruption;
        this.#queue = [...(options.restore?.queuedRuns ?? [])];
        this.#messages = [...(options.restore?.messages ?? [])].sort(
            (left, right) => left.position - right.position,
        );
        for (const message of this.#messages) {
            if (message.isPartial) {
                this.#partialPositions.add(message.position);
            }
        }
        const eventLogOptions: ConstructorParameters<typeof SessionEventLog>[0] = {};
        if (options.events !== undefined) eventLogOptions.events = options.events;
        if (options.onAppendEvent !== undefined) eventLogOptions.onAppend = options.onAppendEvent;
        this.events = new SessionEventLog(eventLogOptions);

        this.#ensureKnownModel(this.#modelId, this.#providerId);
        this.#saveSession();
        if (options.restore === undefined) {
            if (options.emitCreatedEvent !== false) {
                this.emitCreatedEvent();
            }
        } else {
            this.#continueGoalIfIdle();
        }
    }

    abort(): { aborted: boolean; eventId?: EventId } {
        const runId = this.#activeRun?.runId;
        if (this.#activeRun === undefined && this.#queue.length === 0) {
            return { aborted: false };
        }

        const queuedRunIds = this.#queue.map((queued) => queued.runId);
        for (const queued of this.#queue) {
            this.#persistence?.deleteQueuedRun(this.id, queued.runId);
        }
        this.#queue = [];
        this.#pauseActiveGoal();
        this.#activeRun?.controller.abort();
        this.#restoredActiveRunId = undefined;
        void this.#runtime?.processManager.killAll({ forceAfterMs: 500 });
        const event = this.#append("abort_requested", runId !== undefined ? { runId } : {});
        for (const queuedRunId of queuedRunIds) {
            this.#append("run_error", {
                errorMessage: "The queued run was stopped.",
                modelLocked: this.#modelLocked(),
                runId: queuedRunId,
            });
        }
        return { aborted: true, eventId: event.id };
    }

    agentMetadata(): SessionAgentMetadata {
        return { ...this.#agentMetadata };
    }

    changeModel(request: ChangeModelRequest): ProtocolSession {
        const providerId =
            (request.providerId !== undefined
                ? getProviderIdForModel(this.#modelCatalog, request.modelId, request.providerId)
                : getProviderIdForModel(this.#modelCatalog, request.modelId, this.#providerId)) ??
            (request.providerId === undefined
                ? getProviderIdForModel(this.#modelCatalog, request.modelId)
                : undefined);
        if (providerId === undefined) {
            const providerDescription =
                request.providerId !== undefined ? ` for provider '${request.providerId}'` : "";
            throw new Error(`Unknown model '${request.modelId}'${providerDescription}.`);
        }

        if (this.#activeRun !== undefined || this.#queue.length > 0) {
            throw new Error("Wait for the active response to finish before changing models.");
        }

        const model = this.#ensureKnownModel(request.modelId, providerId);

        if (request.modelId === this.#modelId && providerId === this.#providerId) {
            return this.changeEffort(
                request.effort !== undefined ? { effort: request.effort } : {},
            );
        }

        this.#syncContextMessages();
        void this.#runtime?.processManager.killAll({ forceAfterMs: 500 });
        this.#runtime = undefined;
        this.#mcpLoaded = false;
        this.#tools = [];
        this.#modelId = model.id;
        this.#providerId = providerId;
        this.#effort = request.effort ?? model.defaultThinkingLevel;
        this.#models = this.#modelsForProvider(providerId);
        this.#interruption = undefined;
        this.#append("model_changed", {
            ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
            modelId: this.#modelId,
            snapshot: this.#agentSnapshot(),
        });
        return this.snapshot();
    }

    createForkState(): PersistedSessionState {
        if (this.isSubagent()) {
            throw new Error("Subagent histories cannot be forked.");
        }
        if (this.#activeRun !== undefined || this.#queue.length > 0) {
            throw new Error("Wait for the active response to finish before forking this session.");
        }

        this.#syncContextMessages();
        const state = this.state();
        const id = createId();
        const {
            activeRunId: _activeRunId,
            goal: _goal,
            interruption: _interruption,
            title: _title,
            titleError: _titleError,
            ...rest
        } = state;
        const title = state.title === undefined ? undefined : `${state.title} (fork)`;
        return {
            ...rest,
            agent: { depth: 0, rootSessionId: id, type: "primary" },
            agentId: createId(),
            id,
            lastMessageAt: this.#now(),
            messages: state.messages.map((message) => ({ ...message })),
            nextTaskId: 1,
            queuedRuns: [],
            status: "idle",
            tasks: [],
            titleStatus: title === undefined ? "idle" : "ready",
            tools: [],
            ...(title !== undefined ? { title } : {}),
        };
    }

    changeEffort(request: ChangeEffortRequest): ProtocolSession {
        const model = this.#selectedModel();
        const effort = request.effort ?? model.defaultThinkingLevel;
        if (!model.thinkingLevels.includes(effort)) {
            throw new Error(`Model '${model.id}' does not support '${effort}' reasoning.`);
        }

        this.#effort = effort;
        this.#runtime?.agent.setEffort(effort);
        this.#interruption = undefined;
        this.#append("effort_changed", {
            effort,
            modelId: this.#modelId,
            snapshot: this.#agentSnapshot(),
        });
        return this.snapshot();
    }

    changePermissionMode(request: ChangePermissionModeRequest): ProtocolSession {
        const permissionMode = parsePermissionMode(request.permissionMode);
        this.#permissionMode = permissionMode;
        this.#runtime?.context.permissions?.setMode(permissionMode);
        this.#append("permission_mode_changed", { permissionMode });
        return this.snapshot();
    }

    setGoal(request: CreateGoalRequest): SessionGoal {
        if (this.isSubagent()) {
            throw new Error("Goals can only be managed from the primary session.");
        }
        if (this.#goal !== undefined && this.#goal.status !== "complete") {
            throw new Error(
                "This session already has an unfinished goal. Complete or clear it before starting another.",
            );
        }

        const now = this.#now();
        this.#goal = {
            createdAt: now,
            objective: normalizeGoalObjective(request.objective),
            status: "active",
            updatedAt: now,
        };
        this.#lastMessageAt = now;
        this.#append("goal_changed", { goal: { ...this.#goal } });
        if (this.#titleStatus === "idle") {
            this.#title = createGoalTitle(this.#goal.objective);
            this.#titleStatus = "ready";
            this.#append("session_title_changed", {
                status: this.#titleStatus,
                title: this.#title,
            });
        }
        this.#continueGoalIfIdle();
        return { ...this.#goal };
    }

    changeGoalStatus(
        request: ChangeGoalStatusRequest,
        options: { stopActiveGoalRun?: boolean } = {},
    ): SessionGoal {
        if (this.isSubagent()) {
            throw new Error("Goals can only be managed from the primary session.");
        }
        if (this.#goal === undefined) {
            throw new Error("This session does not have a goal.");
        }
        if (request.status === "active" && this.#goal.status === "complete") {
            throw new Error("A completed goal cannot be resumed. Start a new goal instead.");
        }

        this.#goal = { ...this.#goal, status: request.status, updatedAt: this.#now() };
        this.#append("goal_changed", { goal: { ...this.#goal } });
        if (request.status === "active") {
            this.#continueGoalIfIdle();
        } else if (options.stopActiveGoalRun !== false) {
            this.#discardQueuedGoalRuns();
            if (this.#activeRun?.kind === "goal") {
                this.#activeRun.controller.abort();
                void this.#runtime?.processManager.killAll({ forceAfterMs: 500 });
            }
        }
        return { ...this.#goal };
    }

    clearGoal(): boolean {
        if (this.isSubagent()) {
            throw new Error("Goals can only be managed from the primary session.");
        }
        if (this.#goal === undefined) return false;

        this.#goal = undefined;
        this.#discardQueuedGoalRuns();
        if (this.#activeRun?.kind === "goal") {
            this.#activeRun.controller.abort();
            void this.#runtime?.processManager.killAll({ forceAfterMs: 500 });
        }
        this.#append("goal_changed", { goal: null });
        return true;
    }

    goal(): SessionGoal | undefined {
        return this.#goal === undefined ? undefined : { ...this.#goal };
    }

    requestUserInput(
        request: UserInputRequest,
        options: { signal?: AbortSignal } = {},
    ): Promise<UserInputResponse> {
        if (this.isSubagent()) {
            throw new Error("Only the primary session can ask the user a question.");
        }
        if (this.#pendingUserInputs.has(request.requestId)) {
            throw new Error("A user input request with this identifier is already pending.");
        }
        if (isSignalAborted(options.signal)) {
            return Promise.reject(new Error("The user input request was cancelled."));
        }

        const response = new Promise<UserInputResponse>((resolve, reject) => {
            const pending: PendingUserInput = { request, resolve };
            if (options.signal !== undefined) pending.signal = options.signal;
            const onAbort = () => {
                if (this.#pendingUserInputs.get(request.requestId) !== pending) return;
                this.#pendingUserInputs.delete(request.requestId);
                this.#append("user_input_resolved", {
                    requestId: request.requestId,
                    status: "cancelled",
                });
                reject(new Error("The user input request was cancelled."));
            };
            pending.onAbort = onAbort;
            options.signal?.addEventListener("abort", onAbort, { once: true });
            this.#pendingUserInputs.set(request.requestId, pending);
        });
        this.#append("user_input_requested", request);
        if (isSignalAborted(options.signal)) {
            this.#pendingUserInputs.get(request.requestId)?.onAbort?.();
        }
        return response;
    }

    answerUserInput(requestId: string, response: UserInputResponse): ProtocolSession | undefined {
        const pending = this.#pendingUserInputs.get(requestId);
        if (pending === undefined) return undefined;

        const responseAnswers = (response as { answers?: unknown } | null)?.answers;
        if (
            responseAnswers === null ||
            typeof responseAnswers !== "object" ||
            Array.isArray(responseAnswers)
        ) {
            throw new Error("Choose an answer for every question before continuing.");
        }

        const answers: Record<string, readonly string[]> = {};
        for (const question of pending.request.questions) {
            const selected = (responseAnswers as Record<string, unknown>)[question.id];
            if (
                !Array.isArray(selected) ||
                selected.length === 0 ||
                selected.some((answer) => typeof answer !== "string" || answer.trim() === "")
            ) {
                throw new Error(`Answer the ${question.header} question before continuing.`);
            }
            if (!question.multiSelect && selected.length > 1) {
                throw new Error(`Choose one answer for the ${question.header} question.`);
            }
            answers[question.id] = [...selected];
        }

        this.#pendingUserInputs.delete(requestId);
        if (pending.onAbort !== undefined) {
            pending.signal?.removeEventListener("abort", pending.onAbort);
        }
        const normalizedResponse = { answers };
        this.#append("user_input_resolved", {
            answers,
            requestId,
            status: "answered",
        });
        pending.resolve(normalizedResponse);
        return this.snapshot();
    }

    createTask(request: CreateTaskRequest): SessionTask {
        const task: SessionTask = {
            blockedBy: [],
            blocks: [],
            description: request.description,
            id: String(this.#nextTaskId),
            status: "pending",
            subject: request.subject,
            ...(request.activeForm !== undefined ? { activeForm: request.activeForm } : {}),
            ...(request.metadata !== undefined ? { metadata: { ...request.metadata } } : {}),
        };
        this.#nextTaskId += 1;
        this.#tasks.push(task);
        this.#recordTasksChanged();
        return cloneTask(task);
    }

    getTask(taskId: string): SessionTask | undefined {
        const task = this.#tasks.find((candidate) => candidate.id === taskId);
        return task === undefined ? undefined : cloneTask(task);
    }

    listTasks(): readonly SessionTask[] {
        return this.#tasks.map(cloneTask);
    }

    updateTask(taskId: string, request: UpdateTaskRequest): UpdateTaskResult {
        const index = this.#tasks.findIndex((candidate) => candidate.id === taskId);
        const existing = this.#tasks[index];
        if (existing === undefined) {
            return { error: "Task not found", success: false, taskId, updatedFields: [] };
        }
        if (request.status === "deleted") {
            this.#tasks.splice(index, 1);
            this.#tasks = this.#tasks.map((task) => ({
                ...task,
                blockedBy: task.blockedBy.filter((dependency) => dependency !== taskId),
                blocks: task.blocks.filter((dependency) => dependency !== taskId),
            }));
            this.#recordTasksChanged();
            return {
                statusChange: { from: existing.status, to: "deleted" },
                success: true,
                taskId,
                updatedFields: ["deleted"],
            };
        }

        const dependencyError = this.#validateTaskDependencies(taskId, request);
        if (dependencyError !== undefined) {
            return { error: dependencyError, success: false, taskId, updatedFields: [] };
        }

        const task = cloneTask(existing);
        const updatedFields: string[] = [];
        updateTaskString(task, "subject", request.subject, updatedFields);
        updateTaskString(task, "description", request.description, updatedFields);
        updateTaskString(task, "activeForm", request.activeForm, updatedFields);
        updateTaskString(task, "owner", request.owner, updatedFields);
        if (request.metadata !== undefined) {
            const metadata = { ...task.metadata };
            for (const [key, value] of Object.entries(request.metadata)) {
                if (value === null) delete metadata[key];
                else metadata[key] = value;
            }
            task.metadata = metadata;
            updatedFields.push("metadata");
        }
        let statusChange: UpdateTaskResult["statusChange"];
        if (request.status !== undefined && request.status !== task.status) {
            statusChange = { from: task.status, to: request.status };
            task.status = request.status;
            updatedFields.push("status");
        }
        this.#tasks[index] = task;
        this.#addTaskDependencies(taskId, request, updatedFields);
        if (updatedFields.length > 0) this.#recordTasksChanged();
        return {
            success: true,
            taskId,
            updatedFields,
            ...(statusChange !== undefined ? { statusChange } : {}),
        };
    }

    emitCreatedEvent(): void {
        this.#append("session_created", { session: this.snapshot() });
    }

    markInterrupted(interruption: SessionInterruption): void {
        this.#interruption = interruption;
        this.#status = "error";
        this.#activeRun?.controller.abort();
        void this.#runtime?.processManager.killAll({ forceAfterMs: 500 });
        this.#activeRun = undefined;
        this.#restoredActiveRunId = undefined;
        this.#activePartial = undefined;
        this.#pauseActiveGoal();
        const interruptedRunIds = [
            ...(interruption.runId !== undefined ? [interruption.runId] : []),
            ...this.#queue.map((queued) => queued.runId),
        ];
        for (const queued of this.#queue) {
            this.#persistence?.deleteQueuedRun(this.id, queued.runId);
        }
        this.#queue = [];
        if (interruptedRunIds.length > 0) {
            for (const runId of new Set(interruptedRunIds)) {
                this.#append("run_error", {
                    errorMessage: interruption.message,
                    modelLocked: this.#modelLocked(),
                    runId,
                });
            }
            this.#saveSession();
            return;
        }

        this.#saveSession();
    }

    reset(): ProtocolSession {
        this.abort();
        this.#ensureRuntime().agent.reset();
        this.#status = "idle";
        this.#interruption = undefined;
        this.#restoredActiveRunId = undefined;
        this.#lastSessionRunId = undefined;
        this.#messages = [];
        this.#contextMessages = undefined;
        this.#partialPositions.clear();
        this.#activePartial = undefined;
        const hadTasks = this.#tasks.length > 0;
        const hadGoal = this.#goal !== undefined;
        this.#goal = undefined;
        this.#tasks = [];
        this.#nextTaskId = 1;
        this.#persistence?.clearMessages(this.id);
        if (hadTasks) this.#recordTasksChanged();
        if (hadGoal) this.#append("goal_changed", { goal: null });
        this.#append("session_reset", { snapshot: this.#agentSnapshot() });
        return this.snapshot();
    }

    async compact(signal?: AbortSignal): Promise<AgentCompactionResult> {
        if (this.#activeRun !== undefined || this.#queue.length > 0) {
            throw new Error("Wait for the active response to finish before compacting.");
        }

        const previousStatus = this.#status;
        this.#status = "running";
        this.#saveSession();
        try {
            const result = await this.#ensureRuntime().agent.compact(signal);
            this.#syncContextMessages();
            return result;
        } finally {
            this.#status = previousStatus;
            this.#saveSession();
        }
    }

    isSubagent(): boolean {
        return this.#agentMetadata.type === "subagent";
    }

    recordSubagentChanged(subagent: SubagentSummary): void {
        this.#append("subagent_changed", { subagent });
    }

    requestForSubagent(): CreateSessionRequest {
        return {
            cwd: this.#request.cwd,
            ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
            ...(this.#instructions !== undefined ? { instructions: this.#instructions } : {}),
            modelId: this.#modelId,
            ...(this.#request.apiKey !== undefined ? { apiKey: this.#request.apiKey } : {}),
            permissionMode: this.#permissionMode,
        };
    }

    snapshot(): ProtocolSession {
        const snapshot = this.#agentSnapshot();
        const lastEventId = this.events.lastEventId();
        return {
            id: this.id,
            agentId: this.#agentId,
            cwd: this.#request.cwd,
            providerId: this.#providerId,
            permissionMode: this.#permissionMode,
            modelId: this.#modelId,
            modelLocked: this.#modelLocked(),
            models: this.#models,
            status: this.#status,
            snapshot,
            titleStatus: this.#titleStatus,
            agent: this.agentMetadata(),
            pendingUserInputs: [...this.#pendingUserInputs.values()].map(
                (pending) => pending.request,
            ),
            mcpServers: this.#mcpServers,
            tasks: this.listTasks(),
            ...(this.#goal !== undefined ? { goal: { ...this.#goal } } : {}),
            ...(snapshot.effort !== undefined ? { effort: snapshot.effort } : {}),
            ...(this.#title !== undefined ? { title: this.#title } : {}),
            ...(this.#titleError !== undefined ? { titleError: this.#titleError } : {}),
            ...(this.#interruption !== undefined ? { interruption: this.#interruption } : {}),
            ...(lastEventId !== undefined ? { lastEventId } : {}),
        };
    }

    summary(): SessionSummary {
        return {
            id: this.id,
            cwd: this.#request.cwd,
            providerId: this.#providerId,
            permissionMode: this.#permissionMode,
            modelId: this.#modelId,
            ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
            status: this.#status,
            titleStatus: this.#titleStatus,
            createdAt: this.events.firstCreatedAt() ?? this.#now(),
            updatedAt: this.events.lastCreatedAt() ?? this.#now(),
            ...(this.#lastMessageAt !== undefined ? { lastMessageAt: this.#lastMessageAt } : {}),
            ...(this.#title !== undefined ? { title: this.#title } : {}),
            ...(this.#titleError !== undefined ? { titleError: this.#titleError } : {}),
            ...(this.#interruption !== undefined ? { interruption: this.#interruption } : {}),
        };
    }

    state(): PersistedSessionState {
        const activeRunId = this.#activeRun?.runId ?? this.#restoredActiveRunId;
        const runtimeSnapshot = this.#runtime?.agent.snapshot();
        const contextMessages =
            runtimeSnapshot?.contextMessages === undefined
                ? this.#contextMessages
                : [
                      ...runtimeSnapshot.contextMessages,
                      ...runtimeSnapshot.queue.map((queued) => queued.message),
                  ];
        const state: PersistedSessionState = {
            agent: this.agentMetadata(),
            agentId: this.#agentId,
            cwd: this.#request.cwd,
            ...(contextMessages !== undefined ? { contextMessages: [...contextMessages] } : {}),
            ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
            id: this.id,
            ...(this.#instructions !== undefined ? { instructions: this.#instructions } : {}),
            ...(this.#goal !== undefined ? { goal: { ...this.#goal } } : {}),
            ...(this.#interruption !== undefined ? { interruption: this.#interruption } : {}),
            ...(this.#lastMessageAt !== undefined ? { lastMessageAt: this.#lastMessageAt } : {}),
            messages: [...this.#messages],
            modelId: this.#modelId,
            models: this.#models,
            providerId: this.#providerId,
            permissionMode: this.#permissionMode,
            queuedRuns: [...this.#queue],
            nextTaskId: this.#nextTaskId,
            status: this.#status,
            tasks: this.listTasks(),
            ...(this.#title !== undefined ? { title: this.#title } : {}),
            ...(this.#titleError !== undefined ? { titleError: this.#titleError } : {}),
            titleStatus: this.#titleStatus,
            tools: this.#tools,
        };
        if (activeRunId !== undefined) {
            state.activeRunId = activeRunId;
        }
        return state;
    }

    submit(request: SubmitMessageRequest): SubmitMessageResponse {
        const runId = createId();
        const displayText = request.displayText ?? request.text;
        const blocks: readonly ContentBlock[] = request.content ?? [
            { type: "text", text: createCodeReviewPrompt(request.text) ?? request.text },
        ];
        const userMessage: UserMessage = {
            role: "user",
            id: createId(),
            blocks,
        };
        const visibleMessage: UserMessage = {
            role: "user",
            id: userMessage.id,
            blocks: blocks.some((block) => block.type === "image")
                ? blocks
                : displayText.length > 0
                  ? [{ type: "text", text: displayText }]
                  : [],
        };
        const queued: PersistedQueuedRun = {
            displayText,
            kind: "user",
            runId,
            text: request.text,
            userMessage,
        };

        this.#interruption = undefined;
        this.#queue.push(queued);
        this.#persistence?.insertQueuedRun(this.id, queued);
        this.#status = this.#activeRun === undefined ? "queued" : "running";
        this.#lastMessageAt = this.#now();
        this.#separateModelContextFromVisibleTranscript();
        this.#storeMessage(this.#messages.length, visibleMessage, false, runId);
        const event = this.#append("message_submitted", {
            displayText,
            message: visibleMessage,
            runId,
        });
        this.#startTitleGeneration(request.text);
        this.#startDrainQueue();
        return {
            eventId: event.id,
            runId,
            sessionId: this.id,
        };
    }

    steer(request: SubmitMessageRequest): SteerMessageResponse {
        const activeRun = this.#activeRun;
        if (activeRun === undefined) {
            throw new Error("There is no active run to steer.");
        }
        const displayText = request.displayText ?? request.text;
        const blocks: readonly ContentBlock[] = request.content ?? [
            { type: "text", text: request.text },
        ];
        const userMessage: UserMessage = {
            role: "user",
            id: createId(),
            blocks,
        };

        const agent = this.#ensureRuntime().agent;
        if (agent.status === "running") agent.steerMessage(userMessage);
        else agent.enqueueMessage(userMessage);
        this.#interruption = undefined;
        this.#lastMessageAt = this.#now();
        this.#storeMessage(this.#messages.length, userMessage, false, activeRun.runId);
        const event = this.#append("message_submitted", {
            displayText,
            message: userMessage,
            runId: activeRun.runId,
        });
        return {
            eventId: event.id,
            runId: activeRun.runId,
            sessionId: this.id,
        };
    }

    deliverNotification(
        request: SubmitMessageRequest,
    ): SubmitMessageResponse | SteerMessageResponse {
        if (this.#activeRun === undefined) {
            return this.submit(request);
        }

        const activeRun = this.#activeRun;
        const displayText = request.displayText ?? request.text;
        const userMessage: UserMessage = {
            blocks: request.content ?? [{ type: "text", text: request.text }],
            id: createId(),
            role: "user",
        };
        const visibleMessage: UserMessage = {
            blocks: displayText.length > 0 ? [{ type: "text", text: displayText }] : [],
            id: userMessage.id,
            role: "user",
        };
        const agent = this.#ensureRuntime().agent;

        if (agent.status === "running") agent.steerMessage(userMessage);
        else agent.enqueueMessage(userMessage);
        this.#interruption = undefined;
        this.#storeMessage(this.#messages.length, visibleMessage, false, activeRun.runId);
        const event = this.#append("message_submitted", {
            displayText,
            message: visibleMessage,
            runId: activeRun.runId,
        });
        return {
            eventId: event.id,
            runId: activeRun.runId,
            sessionId: this.id,
        };
    }

    subagentSummary(): SubagentSummary {
        if (
            this.#agentMetadata.type !== "subagent" ||
            this.#agentMetadata.parentSessionId === undefined
        ) {
            throw new Error("Only subagent sessions have subagent summaries.");
        }

        return {
            agentId: this.#agentId,
            createdAt: this.events.firstCreatedAt() ?? this.#now(),
            depth: this.#agentMetadata.depth,
            description: this.#agentMetadata.description ?? "Delegated task",
            id: this.id,
            modelId: this.#modelId,
            parentSessionId: this.#agentMetadata.parentSessionId,
            ...(this.#agentMetadata.parentToolCallId !== undefined
                ? { parentToolCallId: this.#agentMetadata.parentToolCallId }
                : {}),
            status: this.#status,
            ...(this.#agentMetadata.taskName !== undefined
                ? { taskName: this.#agentMetadata.taskName }
                : {}),
            updatedAt: this.events.lastCreatedAt() ?? this.#now(),
        };
    }

    waitForRun(runId: string): Promise<SessionRunCompletion> {
        const completed = this.#completionForRun(runId);
        if (completed !== undefined) {
            return Promise.resolve(completed);
        }

        return new Promise((resolve) => {
            const unsubscribe = this.events.subscribe((event) => {
                if (
                    (event.type !== "run_finished" && event.type !== "run_error") ||
                    event.data.runId !== runId
                ) {
                    return;
                }
                unsubscribe();
                resolve(
                    event.type === "run_error"
                        ? { errorMessage: event.data.errorMessage, status: "error" }
                        : {
                              status: event.data.stopReason === "aborted" ? "aborted" : "completed",
                          },
                );
            });
        });
    }

    #agentSnapshot(): AgentSnapshot {
        const runtimeSnapshot = this.#runtime?.agent.snapshot();
        return {
            id: this.#agentId,
            providerId: this.#providerId,
            modelId: this.#modelId,
            status: this.#agentStatus(),
            messages: this.#committedMessages(),
            queue: runtimeSnapshot?.queue ?? [],
            tools: this.#tools,
            ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
            ...((runtimeSnapshot?.contextMessages ?? this.#contextMessages) !== undefined
                ? {
                      contextMessages: [
                          ...(runtimeSnapshot?.contextMessages ?? this.#contextMessages ?? []),
                      ],
                  }
                : {}),
            ...(this.#instructions !== undefined ? { instructions: this.#instructions } : {}),
            ...(runtimeSnapshot?.lastRunId !== undefined
                ? { lastRunId: runtimeSnapshot.lastRunId }
                : {}),
        };
    }

    #agentStatus(): AgentSnapshot["status"] {
        if (this.#status === "running") {
            return "running";
        }
        if (this.#status === "aborted") {
            return "aborted";
        }
        return "idle";
    }

    #validateTaskDependencies(taskId: string, request: UpdateTaskRequest): string | undefined {
        for (const dependency of [...(request.addBlocks ?? []), ...(request.addBlockedBy ?? [])]) {
            if (dependency === taskId) return "A task cannot depend on itself.";
            if (!this.#tasks.some((task) => task.id === dependency)) {
                return `Task ${dependency} was not found.`;
            }
        }
        return undefined;
    }

    #addTaskDependencies(
        taskId: string,
        request: UpdateTaskRequest,
        updatedFields: string[],
    ): void {
        const task = this.#tasks.find((candidate) => candidate.id === taskId);
        if (task === undefined) return;
        for (const blockedTaskId of request.addBlocks ?? []) {
            const blockedTask = this.#tasks.find((candidate) => candidate.id === blockedTaskId);
            if (blockedTask === undefined) continue;
            if (!task.blocks.includes(blockedTaskId)) {
                task.blocks = [...task.blocks, blockedTaskId];
                pushUnique(updatedFields, "blocks");
            }
            if (!blockedTask.blockedBy.includes(taskId)) {
                blockedTask.blockedBy = [...blockedTask.blockedBy, taskId];
            }
        }
        for (const blockingTaskId of request.addBlockedBy ?? []) {
            const blockingTask = this.#tasks.find((candidate) => candidate.id === blockingTaskId);
            if (blockingTask === undefined) continue;
            if (!task.blockedBy.includes(blockingTaskId)) {
                task.blockedBy = [...task.blockedBy, blockingTaskId];
                pushUnique(updatedFields, "blockedBy");
            }
            if (!blockingTask.blocks.includes(taskId)) {
                blockingTask.blocks = [...blockingTask.blocks, taskId];
            }
        }
    }

    #recordTasksChanged(): void {
        this.#append("tasks_changed", { tasks: this.listTasks() });
    }

    async #ensureMcpTools(runtime: CodingAssistantRuntime): Promise<void> {
        if (this.#mcpLoaded) return;
        if (this.#mcpToolProvider === undefined) {
            this.#mcpLoaded = true;
            return;
        }

        const loaded = await this.#mcpToolProvider.load(this.#request.cwd);
        const merged = mergeMcpTools(runtime.agent.tools, loaded);
        runtime.agent.setTools(merged.tools);
        this.#tools = runtime.agent.tools.map((tool) => tool.name);
        this.#mcpServers = merged.servers;
        this.#mcpLoaded = true;
        if (merged.servers.length > 0) {
            this.#append("mcp_servers_changed", { servers: merged.servers });
        }
    }

    #append<TType extends SessionEvent["type"]>(
        type: TType,
        data: Extract<SessionEvent, { type: TType }>["data"],
    ): Extract<SessionEvent, { type: TType }> {
        const event = {
            createdAt: this.#now(),
            data,
            id: this.#createEventId(),
            sessionId: this.id,
            type,
        } as Extract<SessionEvent, { type: TType }>;
        this.events.append(event);
        this.#saveSession();
        return event;
    }

    #appendAgentEvent(runId: string, event: AgentLoopEvent): void {
        if (this.#activeRun?.runId !== runId) {
            return;
        }

        if (event.type === "inference_iteration_start") {
            this.#activePartial = {
                fallbackId: `${runId}:assistant:${event.iteration}`,
                position: undefined,
                runId,
            };
        } else if ("partial" in event) {
            this.#storePartialMessage(runId, event.partial);
        }

        this.#append("agent_event", { event, runId });
    }

    #appendAgentMessage(runId: string, message: Message): void {
        if (this.#activeRun?.runId !== runId) {
            return;
        }

        const existingPosition = this.#messages.find(
            (candidate) => !candidate.isPartial && candidate.message.id === message.id,
        )?.position;
        const partialPosition =
            message.role === "agent" && this.#activePartial?.runId === runId
                ? this.#activePartial.position
                : undefined;
        this.#storeMessage(
            existingPosition ?? partialPosition ?? this.#messages.length,
            message,
            false,
            runId,
        );
        if (partialPosition !== undefined) {
            this.#activePartial = undefined;
        }
        this.#append("agent_message", { message, runId });
    }

    #appendRunFinished(runId: string, result: AgentRunResult): void {
        const stopReason: StopReason = result.stopReason;
        this.#status = stopReason === "aborted" ? "aborted" : "completed";
        this.#activePartial = undefined;
        if (this.#activeRun?.runId === runId) {
            this.#activeRun = undefined;
        }
        this.#append("run_finished", {
            agentRunId: result.runId,
            modelLocked: this.#modelLocked(),
            runId,
            stopReason,
        });
    }

    #committedMessages(): Message[] {
        return this.#messages
            .filter((message) => !message.isPartial)
            .sort((left, right) => left.position - right.position)
            .map((message) => message.message);
    }

    #ensureKnownModel(modelId: string, providerId: string): Model {
        const model = this.#modelsForProvider(providerId).find(
            (candidate) => candidate.id === modelId,
        );
        if (model === undefined) {
            throw new Error(`Unknown model '${modelId}' for provider '${providerId}'.`);
        }
        return model;
    }

    #ensureRuntime(): CodingAssistantRuntime {
        if (this.#runtime !== undefined) {
            return this.#runtime;
        }

        const options: CreateCodingAssistantAgentOptions = {
            agentId: this.#agentId,
            cwd: this.#request.cwd,
            messages: this.#committedMessages(),
            modelId: this.#modelId,
            permissionMode: this.#permissionMode,
            providerId: this.#providerId,
            userInput: {
                request: (request, requestOptions) =>
                    this.requestUserInput(request, requestOptions),
            },
            tasks: {
                create: (request) => this.#taskSession().createTask(request),
                get: (taskId) => this.#taskSession().getTask(taskId),
                list: () => this.#taskSession().listTasks(),
                update: (taskId, request) => this.#taskSession().updateTask(taskId, request),
            },
        };
        if (!this.isSubagent()) {
            options.goals = {
                create: (request) => this.setGoal(request),
                get: () => this.goal(),
                update: (status) => this.changeGoalStatus({ status }, { stopActiveGoalRun: false }),
            };
        }
        if (this.#contextMessages !== undefined) {
            options.contextMessages = this.#contextMessages;
        }
        if (this.#effort !== undefined) options.effort = this.#effort;
        if (this.#instructions !== undefined) options.instructions = this.#instructions;
        if (this.#request.apiKey !== undefined) options.apiKey = this.#request.apiKey;
        const agentManager = this.#agentManager;
        if (agentManager !== undefined) {
            options.subagents = {
                canSpawn: this.#agentMetadata.depth < agentManager.maxDepth,
                depth: this.#agentMetadata.depth,
                followUp: (target, message) => agentManager.followUp(this.id, target, message),
                interrupt: (target) => agentManager.interrupt(this.id, target),
                list: (pathPrefix) => agentManager.list(this.id, pathPrefix),
                maxDepth: agentManager.maxDepth,
                spawn: (request, signal) => agentManager.spawn(this.id, request, signal),
                wait: (timeoutMs, signal) => agentManager.wait(this.id, timeoutMs, signal),
            };
        }
        const runtime = this.#createRuntime(options);
        runtime.context.bash.setActiveSessionCountListener?.((running) => {
            const runId = this.#activeRun?.runId ?? this.#lastSessionRunId ?? "background";
            this.#append("agent_event", {
                event: { type: "background_processes_changed", running },
                runId,
            });
        });
        const snapshot = runtime.agent.snapshot();
        this.#runtime = runtime;
        this.#agentId = snapshot.id;
        this.#providerId = runtime.provider.id;
        this.#modelId = snapshot.modelId;
        this.#effort = snapshot.effort;
        this.#instructions = snapshot.instructions;
        this.#models = this.#modelsForProvider(this.#providerId);
        this.#tools = snapshot.tools;
        this.#saveSession();
        return runtime;
    }

    #taskSession(): InMemorySession {
        return this.#agentManager?.taskSession(this.id) ?? this;
    }

    async #drainQueue(): Promise<void> {
        for (;;) {
            const queued = this.#queue.shift();
            if (queued === undefined) {
                if (this.#status === "queued" || this.#status === "running") {
                    this.#status = "idle";
                }
                this.#saveSession();
                return;
            }

            this.#persistence?.deleteQueuedRun(this.id, queued.runId);
            await this.#runQueued(queued);
        }
    }

    #saveSession(): void {
        this.#persistence?.saveSession(this.state());
    }

    #separateModelContextFromVisibleTranscript(): void {
        if (this.#contextMessages !== undefined) return;

        const runtimeSnapshot = this.#runtime?.agent.snapshot();
        this.#contextMessages = [
            ...(runtimeSnapshot?.contextMessages ??
                runtimeSnapshot?.messages ??
                this.#committedMessages()),
        ];
    }

    #completionForRun(runId: string): SessionRunCompletion | undefined {
        const events = this.events.since(undefined) ?? [];
        for (let index = events.length - 1; index >= 0; index -= 1) {
            const event = events[index];
            if (
                event === undefined ||
                (event.type !== "run_finished" && event.type !== "run_error") ||
                event.data.runId !== runId
            ) {
                continue;
            }
            if (event.type === "run_error") {
                return { errorMessage: event.data.errorMessage, status: "error" };
            }
            return {
                status: event.data.stopReason === "aborted" ? "aborted" : "completed",
            };
        }
        return undefined;
    }

    #modelLocked(): boolean {
        return this.#activeRun !== undefined || this.#queue.length > 0;
    }

    #selectedModel(): Model {
        const model = this.#models.find((candidate) => candidate.id === this.#modelId);
        if (model === undefined) {
            throw new Error(`Unknown model '${this.#modelId}' for provider '${this.#providerId}'.`);
        }
        return model;
    }

    #modelsForProvider(providerId: string): readonly Model[] {
        return (
            this.#modelCatalog.providers.find((provider) => provider.providerId === providerId)
                ?.models ?? []
        );
    }

    #startTitleGeneration(firstMessage: string): void {
        if (
            this.#title !== undefined ||
            this.#titleStatus === "generating" ||
            this.#titleStatus === "ready"
        ) {
            return;
        }

        this.#titleStatus = "generating";
        this.#titleError = undefined;
        this.#append("session_title_changed", { status: this.#titleStatus });
        void this.#generateTitle(firstMessage);
    }

    async #generateTitle(firstMessage: string): Promise<void> {
        try {
            const title = await generateSessionTitle({
                firstMessage,
                now: this.#now,
                provider: this.#ensureRuntime().provider,
                sessionId: this.id,
            });
            this.#title = title;
            this.#titleStatus = "ready";
            this.#titleError = undefined;
            this.#append("session_title_changed", { status: this.#titleStatus, title });
        } catch (error) {
            this.#titleStatus = "error";
            this.#titleError = error instanceof Error ? error.message : String(error);
            this.#append("session_title_changed", {
                errorMessage: this.#titleError,
                status: this.#titleStatus,
            });
        }
    }

    async #runQueued(queued: PersistedQueuedRun): Promise<void> {
        const controller = new AbortController();
        this.#activeRun = { controller, kind: queued.kind, runId: queued.runId };
        this.#lastSessionRunId = queued.runId;
        this.#restoredActiveRunId = undefined;
        this.#status = "running";
        this.#append("run_started", { runId: queued.runId });

        try {
            const runtime = this.#ensureRuntime();
            await this.#ensureMcpTools(runtime);
            runtime.agent.enqueueMessage(queued.userMessage);
            if (this.#contextMessages !== undefined) {
                this.#contextMessages = [...this.#contextMessages, queued.userMessage];
                this.#saveSession();
            }
            const result = await runtime.agent.run({
                signal: controller.signal,
                onEvent: (event) => this.#appendAgentEvent(queued.runId, event),
                onMessage: (message) => this.#appendAgentMessage(queued.runId, message),
            });
            if (this.#activeRun?.runId !== queued.runId) {
                return;
            }
            this.#appendRunFinished(queued.runId, result);
            if (result.stopReason !== "aborted" && result.stopReason !== "error") {
                this.#continueGoalIfIdle();
            }
        } catch (error) {
            if (this.#activeRun?.runId !== queued.runId) {
                return;
            }
            this.#status = "error";
            this.#activePartial = undefined;
            this.#pauseActiveGoal();
            if (this.#activeRun?.runId === queued.runId) {
                this.#activeRun = undefined;
            }
            this.#append("run_error", {
                errorMessage: error instanceof Error ? error.message : String(error),
                modelLocked: this.#modelLocked(),
                runId: queued.runId,
            });
        } finally {
            if (this.#activeRun?.runId === queued.runId) {
                this.#activeRun = undefined;
            }
            this.#syncContextMessages();
            this.#saveSession();
        }
    }

    #syncContextMessages(): void {
        const snapshot = this.#runtime?.agent.snapshot();
        if (snapshot !== undefined) {
            this.#contextMessages = [...(snapshot.contextMessages ?? snapshot.messages)];
        }
    }

    #startDrainQueue(): void {
        if (this.#draining !== undefined) {
            return;
        }

        this.#draining = this.#drainQueue().finally(() => {
            this.#draining = undefined;
        });
    }

    #continueGoalIfIdle(): void {
        if (
            this.isSubagent() ||
            this.#goal?.status !== "active" ||
            this.#restoredActiveRunId !== undefined ||
            this.#status === "running" ||
            this.#activeRun !== undefined ||
            this.#queue.length > 0
        ) {
            return;
        }

        const runId = createId();
        const text = createGoalContinuationPrompt(this.#goal);
        const userMessage: UserMessage = {
            blocks: [{ type: "text", text }],
            id: createId(),
            role: "user",
        };
        const queued: PersistedQueuedRun = {
            displayText: "Continuing active goal",
            kind: "goal",
            runId,
            text,
            userMessage,
        };
        this.#queue.push(queued);
        this.#persistence?.insertQueuedRun(this.id, queued);
        this.#status = "queued";
        this.#saveSession();
        this.#startDrainQueue();
    }

    #discardQueuedGoalRuns(): void {
        const goalRunIds = this.#queue
            .filter((queued) => queued.kind === "goal")
            .map((queued) => queued.runId);
        if (goalRunIds.length === 0) return;

        this.#queue = this.#queue.filter((queued) => queued.kind !== "goal");
        for (const runId of goalRunIds) this.#persistence?.deleteQueuedRun(this.id, runId);
        if (this.#activeRun === undefined && this.#queue.length === 0) this.#status = "idle";
        this.#saveSession();
    }

    #pauseActiveGoal(): void {
        if (this.#goal?.status !== "active") return;
        this.#goal = { ...this.#goal, status: "paused", updatedAt: this.#now() };
        this.#append("goal_changed", { goal: { ...this.#goal } });
    }

    #storeMessage(position: number, message: Message, isPartial: boolean, runId: string): void {
        const entry: PersistedSessionMessage = {
            isPartial,
            message,
            position,
            runId,
        };
        this.#messages = [
            ...this.#messages.filter((candidate) => candidate.position !== position),
            entry,
        ].sort((left, right) => left.position - right.position);
        if (isPartial) {
            this.#partialPositions.add(position);
        } else {
            this.#partialPositions.delete(position);
        }
        this.#persistence?.upsertMessage(this.id, entry);
    }

    #storePartialMessage(
        runId: string,
        partial: Parameters<typeof assistantMessageToAgentMessage>[0],
    ): void {
        const activePartial =
            this.#activePartial?.runId === runId
                ? this.#activePartial
                : {
                      fallbackId: `${runId}:assistant`,
                      position: undefined,
                      runId,
                  };
        const position = activePartial.position ?? this.#messages.length;
        this.#activePartial = {
            ...activePartial,
            position,
        };
        const message = assistantMessageToAgentMessage(partial, () => activePartial.fallbackId);
        this.#storeMessage(position, message, true, runId);
    }
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
    return signal?.aborted === true;
}

function cloneTask(task: SessionTask): SessionTask {
    return {
        ...task,
        blockedBy: [...task.blockedBy],
        blocks: [...task.blocks],
        ...(task.metadata !== undefined ? { metadata: { ...task.metadata } } : {}),
    };
}

function nextTaskId(tasks: readonly SessionTask[]): number {
    return (
        tasks.reduce((highest, task) => {
            const value = Number.parseInt(task.id, 10);
            return Number.isSafeInteger(value) ? Math.max(highest, value) : highest;
        }, 0) + 1
    );
}

function updateTaskString<TKey extends "activeForm" | "description" | "owner" | "subject">(
    task: SessionTask,
    key: TKey,
    value: string | undefined,
    updatedFields: string[],
): void {
    if (value === undefined || task[key] === value) return;
    task[key] = value;
    updatedFields.push(key);
}

function pushUnique(values: string[], value: string): void {
    if (!values.includes(value)) values.push(value);
}
