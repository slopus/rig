import { Buffer } from "node:buffer";

import { createId } from "@paralleldrive/cuid2";

import { assistantMessageToAgentMessage } from "../agent/assistantMessageToAgentMessage.js";
import { findFirstUserRequestText, findLastAgentResponseText } from "../agent/index.js";
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
    ChangeServiceTierRequest,
    CreateSessionRequest,
    EventId,
    ModelCatalog,
    ProtocolSession,
    RewindSessionResponse,
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
import type { Model, Provider, ServiceTier, StopReason } from "../providers/types.js";
import type { ProviderQuota } from "../providers/providerQuota.js";
import type { UserInputRequest, UserInputResponse } from "../user-input/index.js";
import {
    humanizeWorkflowName,
    serializeWorkflowValue,
    type LaunchWorkflowRequest,
    type WorkflowAgentCacheEntry,
    type WorkflowCheckpoint,
    type WorkflowRun,
    type WorkflowRunUpdate,
} from "../workflows/index.js";
import { createCodeReviewPrompt } from "../review/index.js";
import {
    createMcpTrustUserInputRequest,
    MCP_TRUST_ANSWER,
    mergeMcpTools,
    type McpServerSummary,
    type McpServerTrustRequest,
    type McpToolProvider,
} from "../mcp/index.js";
import type {
    CreateTaskRequest,
    SessionTask,
    UpdateTaskRequest,
    UpdateTaskResult,
} from "../tasks/index.js";
import {
    DEFAULT_PERMISSION_MODE,
    isPermissionReduction,
    parsePermissionMode,
    type PermissionMode,
} from "../permissions/index.js";
import { createSessionMetadataTranscript } from "./createSessionMetadataTranscript.js";
import { generateSessionMetadata } from "./generateSessionMetadata.js";
import { createGoalTitle } from "./createGoalTitle.js";
import { getProviderIdForModel } from "./getProviderIdForModel.js";
import { resolveInitialModelSelection } from "./resolveInitialModelSelection.js";
import { SessionEventLog } from "./SessionEventLog.js";
import type { AgentSessionManager } from "./AgentSessionManager.js";
import type { DockerExecutionConfig } from "../execution/index.js";
import { summarizeDockerExecution } from "../execution/index.js";
import type { TaskDrain } from "./TrackedTaskDrain.js";
import { aggregateSessionUsage, type SessionUsageSummary } from "./sessionUsage/index.js";

export interface PersistedSessionMessage {
    isPartial: boolean;
    message: Message;
    position: number;
    runId?: string;
}

export interface PersistedQueuedRun {
    displayText: string;
    interactive?: boolean;
    kind: "goal" | "user";
    runId: string;
    text: string;
    userMessage: UserMessage;
}

export interface PersistedSessionState {
    activeSince?: number;
    activeRunId?: string;
    agent: SessionAgentMetadata;
    agentId: string;
    cwd: string;
    docker?: DockerExecutionConfig;
    elapsedMs?: number;
    contextMessages?: readonly Message[];
    effort?: string;
    serviceTier?: ServiceTier;
    id: string;
    instructions?: string;
    goal?: SessionGoal;
    interruption?: SessionInterruption;
    lastMessageAt?: number;
    metadataRunId?: string;
    metadataUpdatedAt?: number;
    messages: readonly PersistedSessionMessage[];
    modelId: string;
    models: readonly Model[];
    providerId: string;
    permissionMode: PermissionMode;
    queuedRuns: readonly PersistedQueuedRun[];
    recap?: string;
    nextTaskId: number;
    status: SessionStatus;
    tasks: readonly SessionTask[];
    title?: string;
    titleError?: string;
    titleStatus: SessionTitleStatus;
    totalTokens?: number;
    tools: readonly string[];
    workflows?: readonly PersistedWorkflowRun[];
    workflowsEnabled?: boolean;
}

export interface PersistedWorkflowRun {
    agentCalls: readonly (WorkflowAgentCacheEntry | undefined)[];
    checkpoint?: {
        nextAgentCallIndex: number;
        phase: string;
        snapshotBase64: string;
    };
    state: WorkflowRun;
}

export interface InMemorySessionPersistence {
    clearMessages(sessionId: string): void;
    deleteMessagesFrom(sessionId: string, position: number): void;
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
    initialContextMessages?: readonly Message[];
    lastEventId?: EventId;
    now?: () => number;
    modelCatalog: ModelCatalog;
    metadata?: SessionAgentMetadata;
    mcpToolProvider?: McpToolProvider;
    onAppendEvent?: (event: SessionEvent) => void;
    persistence?: InMemorySessionPersistence;
    request: CreateSessionRequest;
    restore?: PersistedSessionState;
    taskDrain?: TaskDrain;
}

interface ActiveRun {
    controller: AbortController;
    kind: PersistedQueuedRun["kind"];
    runId: string;
}

interface InternalWorkflowRun {
    agentCalls: (WorkflowAgentCacheEntry | undefined)[];
    checkpoint?: WorkflowCheckpoint;
    completion: Promise<WorkflowRun>;
    controller: AbortController;
    resolveCompletion: (run: WorkflowRun) => void;
    state: WorkflowRun;
}

const MAX_WORKFLOW_LOG_CHARS = 4_000;
const MAX_SUBAGENT_INSPECTION_TEXT_CHARS = 32_000;
const SESSION_SETTLEMENT_DELAY_MS = 60_000;

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

interface PendingSteeringMessage {
    message: UserMessage;
    runId: string;
}

interface PendingSteeringContinuation {
    cancelled: boolean;
    ready: Promise<void>;
    resolveReady: () => void;
}

export interface SessionRunCompletion {
    errorMessage?: string;
    status: "aborted" | "completed" | "error";
}

export class InMemorySession {
    #activeSince: number | undefined;
    readonly events: SessionEventLog;
    readonly id: string;

    #activePartial: PartialMessageState | undefined;
    #activeRun: ActiveRun | undefined;
    #agentManager: AgentSessionManager | undefined;
    #agentMetadata: SessionAgentMetadata;
    #agentId: string;
    #createEventId: () => EventId;
    #createRuntime: (options: CreateCodingAssistantAgentOptions) => CodingAssistantRuntime;
    #compactionController: AbortController | undefined;
    #contextMessages: Message[] | undefined;
    #closing = false;
    #compactionActive = false;
    #draining: Promise<void> | undefined;
    #elapsedMs = 0;
    #effort: string | undefined;
    #serviceTier: ServiceTier | undefined;
    #goal: SessionGoal | undefined;
    #instructions: string | undefined;
    #interruption: SessionInterruption | undefined;
    #lastMessageAt: number | undefined;
    #lastSessionRunId: string | undefined;
    #latestMetadataBoundaryRunId: string | undefined;
    #metadataController: AbortController | undefined;
    #metadataDelayCancel: (() => void) | undefined;
    #metadataRevision = 0;
    #metadataRunId: string | undefined;
    #metadataTimer: ReturnType<typeof setTimeout> | undefined;
    #metadataUpdatedAt: number | undefined;
    #messages: PersistedSessionMessage[] = [];
    #mcpLoaded = false;
    #mcpServers: readonly McpServerSummary[] = [];
    #mcpToolNames = new Set<string>();
    #mcpToolProvider: McpToolProvider | undefined;
    #modelCatalog: ModelCatalog;
    #modelId: string;
    #models: readonly Model[];
    #nextTaskId = 1;
    #now: () => number;
    #partialPositions = new Set<number>();
    #pendingSteeringMessages = new Map<string, PendingSteeringMessage>();
    #pendingSteeringContinuations = new Map<string, PendingSteeringContinuation>();
    #pendingUserInputs = new Map<string, PendingUserInput>();
    #persistence: InMemorySessionPersistence | undefined;
    #providerId: string;
    #permissionMode: PermissionMode;
    #queue: PersistedQueuedRun[] = [];
    #recap: string | undefined;
    #request: CreateSessionRequest;
    #restoredActiveRunId: string | undefined;
    #runtime: CodingAssistantRuntime | undefined;
    #status: SessionStatus = "idle";
    #suspendedRunIds = new Set<string>();
    #suspendOnAbort = false;
    #shutdownCleanup: Promise<void> | undefined;
    #tasks: SessionTask[] = [];
    #taskDrain: TaskDrain | undefined;
    #title: string | undefined;
    #titleError: string | undefined;
    #titleStatus: SessionTitleStatus = "idle";
    #totalTokens = 0;
    #tools: readonly string[] = [];
    #workflowRuns = new Map<string, InternalWorkflowRun>();
    #workflowsEnabled: boolean;

    constructor(options: InMemorySessionOptions) {
        this.#agentManager = options.agentManager;
        this.#createEventId = options.createEventId;
        this.#createRuntime = options.createRuntime ?? createCodingAssistantAgent;
        this.#now = options.now ?? Date.now;
        this.#mcpToolProvider = options.mcpToolProvider;
        this.#modelCatalog = options.modelCatalog;
        this.#persistence = options.persistence;
        this.#request = {
            ...options.request,
            ...(options.request.docker === undefined
                ? {}
                : { docker: { ...options.request.docker } }),
        };
        this.#taskDrain = options.taskDrain;
        this.#workflowsEnabled =
            options.restore?.workflowsEnabled ?? options.request.workflowsEnabled ?? true;
        this.id = options.restore?.id ?? createId();
        this.#agentMetadata = options.restore?.agent ??
            options.metadata ?? {
                depth: 0,
                rootSessionId: this.id,
                type: "primary",
            };
        if (this.#request.docker?.image !== undefined && this.#request.docker.name === undefined) {
            this.#request.docker = {
                ...this.#request.docker,
                name: `rig-${this.#agentMetadata.rootSessionId}`,
            };
        }
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
        const requestedServiceTier = options.restore?.serviceTier ?? options.request.serviceTier;
        if (
            requestedServiceTier !== undefined &&
            !this.#providerSupportsServiceTier(selection.providerId, requestedServiceTier)
        ) {
            this.#serviceTier = undefined;
        } else {
            this.#serviceTier = requestedServiceTier;
        }
        this.#instructions = options.restore?.instructions ?? options.request.instructions;
        this.#goal = options.restore?.goal === undefined ? undefined : { ...options.restore.goal };
        this.#contextMessages =
            options.restore?.contextMessages === undefined
                ? options.initialContextMessages === undefined
                    ? undefined
                    : [...options.initialContextMessages]
                : [...options.restore.contextMessages];
        this.#models = this.#modelsForProvider(this.#providerId);
        this.#status = options.restore?.status ?? "idle";
        this.#activeSince = options.restore?.activeSince;
        this.#elapsedMs = options.restore?.elapsedMs ?? 0;
        this.#lastMessageAt = options.restore?.lastMessageAt;
        this.#metadataRunId = options.restore?.metadataRunId;
        this.#metadataUpdatedAt = options.restore?.metadataUpdatedAt;
        this.#recap = options.restore?.recap;
        this.#restoredActiveRunId = options.restore?.activeRunId;
        this.#lastSessionRunId = options.restore?.activeRunId;
        this.#title = options.restore?.title ?? this.#agentMetadata.description;
        this.#titleError = options.restore?.titleError;
        this.#titleStatus =
            options.restore?.titleStatus ??
            (this.#agentMetadata.description !== undefined ? "ready" : "idle");
        this.#totalTokens = options.restore?.totalTokens ?? 0;
        this.#tasks =
            options.restore?.tasks === undefined ? [] : options.restore.tasks.map(cloneTask);
        this.#nextTaskId = options.restore?.nextTaskId ?? nextTaskId(this.#tasks);
        this.#tools = options.restore?.tools ?? [];
        this.#interruption = options.restore?.interruption;
        this.#queue = [...(options.restore?.queuedRuns ?? [])];
        this.#messages = [...(options.restore?.messages ?? [])].sort(
            (left, right) => left.position - right.position,
        );
        for (const persisted of options.restore?.workflows ?? []) {
            const state = cloneWorkflowRun(persisted.state);
            if (state.status === "running") {
                state.error = "The workflow was interrupted when the local server stopped.";
                state.finishedAt = this.#now();
                state.status = "stopped";
            }
            let resolveCompletion = (_run: WorkflowRun): void => undefined;
            const completion = new Promise<WorkflowRun>((resolve) => {
                resolveCompletion = resolve;
            });
            const internal: InternalWorkflowRun = {
                agentCalls: [...persisted.agentCalls],
                completion,
                controller: new AbortController(),
                resolveCompletion,
                state,
                ...(persisted.checkpoint === undefined
                    ? {}
                    : {
                          checkpoint: {
                              nextAgentCallIndex: persisted.checkpoint.nextAgentCallIndex,
                              phase: persisted.checkpoint.phase,
                              snapshot: new Uint8Array(
                                  Buffer.from(persisted.checkpoint.snapshotBase64, "base64"),
                              ),
                          },
                      }),
            };
            internal.resolveCompletion(cloneWorkflowRun(state));
            this.#workflowRuns.set(state.runId, internal);
        }
        for (const message of this.#messages) {
            if (message.isPartial) {
                this.#partialPositions.add(message.position);
            }
        }
        const eventLogOptions: ConstructorParameters<typeof SessionEventLog>[0] = {};
        if (options.events !== undefined) eventLogOptions.events = options.events;
        if (options.lastEventId !== undefined) eventLogOptions.lastEventId = options.lastEventId;
        if (options.onAppendEvent !== undefined) eventLogOptions.onAppend = options.onAppendEvent;
        this.events = new SessionEventLog(eventLogOptions);

        this.#latestMetadataBoundaryRunId = findLatestForegroundRunBoundary(
            this.events.since(undefined) ?? [],
        );
        this.#ensureKnownModel(this.#modelId, this.#providerId);
        this.#saveSession();
        if (options.restore === undefined) {
            if (options.emitCreatedEvent !== false) {
                this.emitCreatedEvent();
            }
        } else {
            this.#continueGoalIfIdle();
            if (!this.isSubagent()) this.#restartMetadataSettlement();
        }
    }

    async abort(
        options: { continuePendingSteering?: boolean; pauseDescendants?: boolean } = {},
    ): Promise<{
        aborted: boolean;
        continued?: boolean;
        eventId?: EventId;
        stoppedProcesses?: number;
    }> {
        const runId = this.#activeRun?.runId;
        const shouldContinuePendingSteering =
            options.continuePendingSteering === true &&
            runId !== undefined &&
            [...this.#pendingSteeringMessages.values()].some((pending) => pending.runId === runId);
        if (
            options.continuePendingSteering === true &&
            runId !== undefined &&
            !shouldContinuePendingSteering
        ) {
            return { aborted: false, continued: true };
        }
        let continuation: PendingSteeringContinuation | undefined;
        if (shouldContinuePendingSteering && runId !== undefined) {
            continuation = this.#pendingSteeringContinuations.get(runId);
            if (continuation === undefined) {
                let resolveReady = () => {};
                const ready = new Promise<void>((resolve) => {
                    resolveReady = resolve;
                });
                continuation = { cancelled: false, ready, resolveReady };
                this.#pendingSteeringContinuations.set(runId, continuation);
            }
        } else if (runId !== undefined) {
            const pendingContinuation = this.#pendingSteeringContinuations.get(runId);
            if (pendingContinuation !== undefined) {
                pendingContinuation.cancelled = true;
                pendingContinuation.resolveReady();
                this.#pendingSteeringContinuations.delete(runId);
            }
        }
        const pauseDescendants =
            options.pauseDescendants === false
                ? Promise.resolve(0)
                : (this.#agentManager?.pauseDescendants(this.id) ?? Promise.resolve(0));
        const runningProcesses = this.#activeProcessCount();
        if (this.#activeRun === undefined && this.#queue.length === 0 && runningProcesses === 0) {
            return { aborted: (await pauseDescendants) > 0 };
        }

        if (this.#activeRun === undefined && this.#queue.length === 0) {
            const [, pausedDescendants] = await Promise.all([
                this.#killRuntimeProcesses(),
                pauseDescendants,
            ]);
            return {
                aborted: pausedDescendants > 0,
                stoppedProcesses: runningProcesses,
            };
        }

        const queuedRunIds = this.#queue.map((queued) => queued.runId);
        for (const queued of this.#queue) {
            this.#persistence?.deleteQueuedRun(this.id, queued.runId);
        }
        this.#queue = [];
        this.#pauseActiveGoal();
        this.#activeRun?.controller.abort();
        this.#restoredActiveRunId = undefined;
        await Promise.all([this.#killRuntimeProcesses(), pauseDescendants]);
        continuation?.resolveReady();
        const event = this.#append("abort_requested", runId !== undefined ? { runId } : {});
        for (const queuedRunId of queuedRunIds) {
            this.#append("run_error", {
                errorMessage: "The queued run was stopped.",
                modelLocked: this.#modelLocked(),
                runId: queuedRunId,
            });
        }
        const latestQueuedRunId = queuedRunIds.at(-1);
        if (latestQueuedRunId !== undefined) {
            this.#latestMetadataBoundaryRunId = latestQueuedRunId;
            this.#restartMetadataSettlement();
        }
        return {
            aborted: true,
            ...(shouldContinuePendingSteering ? { continued: true } : {}),
            eventId: event.id,
            ...(runningProcesses > 0 ? { stoppedProcesses: runningProcesses } : {}),
        };
    }

    async stopBackgroundProcesses(): Promise<number> {
        const runtime = this.#runtime;
        if (runtime === undefined) return 0;
        const runningProcesses = runtime.context.bash.activeSessionCount?.() ?? 0;
        await runtime.context.bash.killAllSessions?.();
        return runningProcesses;
    }

    async suspendByParent(): Promise<void> {
        if (!this.isSubagent()) return;
        if (this.#activeRun !== undefined) this.#suspendedRunIds.add(this.#activeRun.runId);
        this.#suspendOnAbort = true;
        await this.abort({ pauseDescendants: false });
        this.#status = "suspended";
        if (this.#activeRun === undefined) this.#suspendOnAbort = false;
        this.#saveSession();
    }

    resumeSuspended(): SubmitMessageResponse {
        if (!this.isSubagent() || this.#status !== "suspended") {
            throw new Error("Only a suspended subagent can be resumed.");
        }
        this.#suspendOnAbort = false;
        return this.submit({
            displayText: "Resuming delegated work",
            text: "Continue the delegated task from where you stopped. Re-check any interrupted tool calls before proceeding.",
        });
    }

    clearSuspension(): void {
        this.#suspendOnAbort = false;
        if (this.#status !== "suspended") return;
        this.#status = "aborted";
        this.#saveSession();
    }

    consumeSuspendedRun(runId: string): boolean {
        return this.#suspendedRunIds.delete(runId);
    }

    recordSubagentsSuspended(subagents: readonly { description: string; path: string }[]): void {
        if (subagents.length === 0) return;
        const count = subagents.length;
        const names = subagents.map((subagent) => subagent.description).join(", ");
        const displayText = `${count} ${count === 1 ? "subagent was" : "subagents were"} suspended: ${names}. They will remain suspended until explicitly resumed or redirected.`;
        this.#ensureRuntime().agent.enqueueMessage({
            blocks: [
                {
                    type: "text",
                    text: [
                        "<subagent-suspension>",
                        "The parent turn was interrupted. These delegated agents were suspended:",
                        ...subagents.map(
                            (subagent) => `- ${subagent.path}: ${subagent.description}`,
                        ),
                        "They will not resume automatically. Use resume_agent to continue retained work, followup_task to resume with revised instructions, or interrupt_agent to leave work stopped.",
                        "</subagent-suspension>",
                    ].join("\n"),
                },
            ],
            id: createId(),
            role: "user",
        });
        this.#append("subagents_suspended", { displayText });
    }

    agentMetadata(): SessionAgentMetadata {
        return { ...this.#agentMetadata };
    }

    usage(): SessionUsageSummary {
        return aggregateSessionUsage(this.events.since(undefined) ?? [], {
            type: this.#agentMetadata.type,
        });
    }

    providerQuota(options?: { fresh?: boolean }): Promise<ProviderQuota | undefined> {
        return this.#ensureRuntime().provider.quota?.(options) ?? Promise.resolve(undefined);
    }

    hasModel(modelId: string, providerId?: string): boolean {
        return getProviderIdForModel(this.#modelCatalog, modelId, providerId) !== undefined;
    }

    hasLocalSettlementWork(): boolean {
        return (
            this.#activeRun !== undefined ||
            this.#queue.length > 0 ||
            this.#compactionActive ||
            [...this.#workflowRuns.values()].some((run) => run.state.status === "running") ||
            (this.#runtime?.context.bash.activeSessionCount?.() ?? 0) > 0
        );
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
        void this.#killRuntimeProcesses();
        this.#runtime = undefined;
        this.#mcpLoaded = false;
        this.#mcpServers = [];
        this.#mcpToolNames.clear();
        this.#tools = [];
        this.#modelId = model.id;
        this.#providerId = providerId;
        this.#effort = request.effort ?? model.defaultThinkingLevel;
        if (
            this.#serviceTier !== undefined &&
            !this.#providerSupportsServiceTier(providerId, this.#serviceTier)
        ) {
            this.#serviceTier = undefined;
        }
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
            metadataRunId: _metadataRunId,
            metadataUpdatedAt: _metadataUpdatedAt,
            recap: _recap,
            workflows: _workflows,
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
            workflows: [],
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

    changeServiceTier(request: ChangeServiceTierRequest): ProtocolSession {
        const serviceTier = request.serviceTier;
        if (
            serviceTier !== undefined &&
            !this.#providerSupportsServiceTier(this.#providerId, serviceTier)
        ) {
            throw new Error(`Provider '${this.#providerId}' does not support fast inference.`);
        }

        this.#serviceTier = serviceTier;
        this.#runtime?.agent.setServiceTier(serviceTier);
        this.#interruption = undefined;
        this.#append("service_tier_changed", {
            serviceTier: serviceTier ?? null,
            snapshot: this.#agentSnapshot(),
        });
        return this.snapshot();
    }

    async changePermissionMode(
        request: ChangePermissionModeRequest,
        options: { updateSubagents?: boolean } = {},
    ): Promise<ProtocolSession> {
        const permissionMode = parsePermissionMode(request.permissionMode);
        if (!this.isSubagent() && options.updateSubagents !== false) {
            await this.#agentManager?.changeSubagentPermissionModes(this.id, permissionMode);
        }
        const runtime = this.#runtime;
        const running = this.#activeProcessCount();
        if (running > 0 && isPermissionReduction(this.#permissionMode, permissionMode)) {
            await this.#killRuntimeProcesses();
            const runId = this.#activeRun?.runId ?? this.#lastSessionRunId ?? "background";
            this.#append("agent_event", {
                event: { type: "background_processes_stopped", count: running },
                runId,
            });
        }
        const permissionChanged = this.#permissionMode !== permissionMode;
        this.#permissionMode = permissionMode;
        runtime?.context.permissions?.setMode(permissionMode);
        if (permissionChanged) {
            this.#removeMcpTools(runtime);
        }
        this.#append("permission_mode_changed", { permissionMode });
        if (
            permissionChanged &&
            runtime !== undefined &&
            permissionMode !== "auto" &&
            permissionMode !== "full_access"
        ) {
            await this.#ensureMcpTools(runtime);
        }
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
            void this.#agentManager?.pauseDescendants(this.id);
            this.#discardQueuedGoalRuns();
            if (this.#activeRun?.kind === "goal") {
                this.#activeRun.controller.abort();
                void this.#killRuntimeProcesses();
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
        void this.#agentManager?.stopDescendants(this.id);
        this.#discardQueuedGoalRuns();
        if (this.#activeRun?.kind === "goal") {
            this.#activeRun.controller.abort();
            void this.#killRuntimeProcesses();
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

    getWorkflow(runId: string): WorkflowRun | undefined {
        const run = this.#workflowRuns.get(runId)?.state;
        return run === undefined ? undefined : cloneWorkflowRun(run);
    }

    listWorkflows(): readonly WorkflowRun[] {
        return [...this.#workflowRuns.values()]
            .map((run) => cloneWorkflowRun(run.state))
            .sort((left, right) => right.startedAt - left.startedAt);
    }

    async waitForWorkflow(runId: string, signal?: AbortSignal): Promise<WorkflowRun | undefined> {
        const internal = this.#workflowRuns.get(runId);
        if (internal === undefined) return undefined;
        if (internal.state.status !== "running") return cloneWorkflowRun(internal.state);
        if (signal?.aborted === true) throw new Error("Waiting for the workflow was cancelled.");

        return await new Promise<WorkflowRun>((resolve, reject) => {
            let settled = false;
            const finish = (run: WorkflowRun) => {
                if (settled) return;
                settled = true;
                signal?.removeEventListener("abort", abort);
                resolve(run);
            };
            const abort = () => {
                if (settled) return;
                settled = true;
                reject(new Error("Waiting for the workflow was cancelled."));
            };
            signal?.addEventListener("abort", abort, { once: true });
            void internal.completion.then(finish);
        });
    }

    launchWorkflow(request: LaunchWorkflowRequest): WorkflowRun {
        this.#assertAcceptingWork();
        if (!this.#workflowsEnabled) {
            throw new Error("Workflows are disabled for this session.");
        }
        const resumed =
            request.resumeFromRunId === undefined
                ? undefined
                : this.#workflowRuns.get(request.resumeFromRunId);
        if (request.resumeFromRunId !== undefined && resumed === undefined) {
            throw new Error("The workflow run to resume was not found in this session.");
        }
        if (resumed?.state.status === "running") {
            throw new Error("Stop the previous workflow run before resuming it.");
        }
        const resumeCheckpoint =
            resumed?.state.code === request.code ? resumed.checkpoint : undefined;

        const runId = createId();
        const controller = new AbortController();
        let resolveCompletion = (_run: WorkflowRun): void => undefined;
        const completion = new Promise<WorkflowRun>((resolve) => {
            resolveCompletion = resolve;
        });
        const state: WorkflowRun = {
            agentCount: 0,
            code: request.code,
            description: request.description,
            logs: [],
            name: request.name,
            runId,
            startedAt: this.#now(),
            status: "running",
            taskId: `workflow:${runId}`,
        };
        const internal: InternalWorkflowRun = {
            agentCalls: [],
            completion,
            controller,
            resolveCompletion,
            state,
        };
        this.#workflowRuns.set(runId, internal);
        this.#recordWorkflowUpdate({
            agentCount: state.agentCount,
            code: request.code,
            description: state.description,
            name: state.name,
            runId,
            startedAt: state.startedAt,
            status: state.status,
            taskId: state.taskId,
        });
        const execute = () =>
            request
                .execute({
                    onAgentCall: () => {
                        state.agentCount += 1;
                        this.#recordWorkflowUpdate({ agentCount: state.agentCount, runId });
                    },
                    onAgentResult: (index, result) => {
                        internal.agentCalls[index] = result;
                        this.#saveSession();
                    },
                    onCheckpoint: (checkpoint) => {
                        internal.checkpoint = checkpoint;
                        this.#saveSession();
                    },
                    onLog: (message) => {
                        const trimmed = message.trim();
                        if (trimmed.length === 0) return;
                        const logs = state.logs as string[];
                        logs.push(
                            trimmed.length <= MAX_WORKFLOW_LOG_CHARS
                                ? trimmed
                                : `${trimmed.slice(0, MAX_WORKFLOW_LOG_CHARS)}…`,
                        );
                        if (logs.length > 200) logs.shift();
                        const log = logs.at(-1);
                        const phase = /^Phase:\s*(.+)$/u.exec(log ?? "")?.[1]?.trim();
                        if (phase !== undefined && phase.length > 0) state.phase = phase;
                        if (log !== undefined) {
                            this.#recordWorkflowUpdate({
                                log,
                                ...(state.phase === undefined ? {} : { phase: state.phase }),
                                runId,
                            });
                        }
                    },
                    resumeAgentCalls: resumed?.agentCalls ?? [],
                    ...(resumeCheckpoint === undefined ? {} : { resumeCheckpoint }),
                    runId,
                    signal: controller.signal,
                })
                .then((result) => {
                    if (this.#workflowRuns.get(runId) !== internal) return;
                    internal.agentCalls = [...result.agentCalls];
                    state.output = result.output;
                    state.finishedAt = this.#now();
                    state.status = "completed";
                    this.#recordWorkflowUpdate({
                        finishedAt: state.finishedAt,
                        output: state.output,
                        runId,
                        status: state.status,
                    });
                })
                .catch((error: unknown) => {
                    if (this.#workflowRuns.get(runId) !== internal) return;
                    if (state.status !== "stopped") {
                        state.error = error instanceof Error ? error.message : String(error);
                        state.finishedAt = this.#now();
                        state.status = "error";
                        this.#recordWorkflowUpdate({
                            error: state.error,
                            finishedAt: state.finishedAt,
                            runId,
                            status: state.status,
                        });
                    }
                })
                .finally(() => {
                    if (this.#workflowRuns.get(runId) !== internal) return;
                    internal.resolveCompletion(cloneWorkflowRun(state));
                    if (this.#closing) return;
                    const statusText =
                        state.status === "completed"
                            ? "completed"
                            : state.status === "stopped"
                              ? "was stopped"
                              : "failed";
                    const resultText =
                        state.status === "completed"
                            ? serializeWorkflowValue(state.output)
                            : (state.error ?? "The workflow did not return a result.");
                    this.deliverNotification({
                        displayText: `Workflow ${humanizeWorkflowName(state.name)} ${statusText}.`,
                        text: [
                            "<workflow-notification>",
                            `Workflow: ${state.name}`,
                            `Run ID: ${state.runId}`,
                            `Status: ${state.status}`,
                            `Agents: ${state.agentCount}`,
                            `Result: ${resultText}`,
                            ...(state.logs.length === 0
                                ? []
                                : ["Progress:", ...state.logs.map((log) => `- ${log}`)]),
                            "</workflow-notification>",
                        ].join("\n"),
                    });
                });
        const execution = this.#taskDrain?.run(execute) ?? execute();
        void execution.catch(() => undefined);
        return cloneWorkflowRun(state);
    }

    stopWorkflow(runId: string): WorkflowRun | undefined {
        const run = this.#workflowRuns.get(runId);
        if (run === undefined) return undefined;
        if (run.state.status === "running") {
            run.state.status = "stopped";
            run.state.error = "The workflow was stopped.";
            run.state.finishedAt = this.#now();
            run.controller.abort();
            this.#recordWorkflowUpdate({
                error: run.state.error,
                finishedAt: run.state.finishedAt,
                runId,
                status: run.state.status,
            });
        }
        return cloneWorkflowRun(run.state);
    }

    emitCreatedEvent(): void {
        this.#append("session_created", { session: this.snapshot() });
    }

    beginShutdown(): Promise<void> {
        if (this.#shutdownCleanup !== undefined) return this.#shutdownCleanup;
        this.#closing = true;
        this.#clearMetadataSettlement();
        for (const workflow of this.#workflowRuns.values()) {
            if (workflow.state.status === "running") this.stopWorkflow(workflow.state.runId);
        }
        this.#activeRun?.controller.abort();
        this.#compactionController?.abort();
        this.#shutdownCleanup = this.#killRuntimeProcesses(5_000);
        return this.#shutdownCleanup;
    }

    isClosing(): boolean {
        return this.#closing;
    }

    markInterrupted(interruption: SessionInterruption): void {
        this.#finishElapsedInterval();
        this.#interruption = interruption;
        this.#status = "error";
        this.#activeRun?.controller.abort();
        if (!this.#closing) void this.#killRuntimeProcesses();
        this.#activeRun = undefined;
        this.#restoredActiveRunId = undefined;
        this.#activePartial = undefined;
        this.#pendingSteeringMessages.clear();
        this.#suspendedRunIds.clear();
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
                    startupInterruption: true,
                });
            }
            this.#latestMetadataBoundaryRunId = interruptedRunIds.at(-1);
            this.#restartMetadataSettlement();
            this.#saveSession();
            return;
        }

        this.#saveSession();
    }

    markSuspendedAfterRestart(message: string, runId?: string): void {
        if (!this.isSubagent() || this.#status !== "suspended") {
            throw new Error("Only a suspended subagent can be repaired as resumable.");
        }
        this.#finishElapsedInterval();
        this.#activeRun?.controller.abort();
        this.#activeRun = undefined;
        this.#restoredActiveRunId = undefined;
        this.#activePartial = undefined;
        this.#suspendOnAbort = false;
        for (const queued of this.#queue) {
            this.#persistence?.deleteQueuedRun(this.id, queued.runId);
        }
        this.#queue = [];
        if (runId !== undefined) {
            this.#append("run_error", {
                errorMessage: message,
                modelLocked: this.#modelLocked(),
                runId,
                startupInterruption: true,
            });
        }
        this.#status = "suspended";
        this.#saveSession();
    }

    recordSubagentStoppedAfterRestart(subagent: SubagentSummary): void {
        const taskName = subagent.taskName ?? subagent.id;
        const runId = `restart:${subagent.id}`;
        const displayText = `Background work "${subagent.description}" stopped when the local server restarted.`;
        const message: UserMessage = {
            blocks: [
                {
                    type: "text",
                    text: [
                        "<subagent-notification>",
                        `Task: ${taskName}`,
                        "Status: suspended",
                        "Result: The subagent stopped working when the local server restarted. It remains suspended and will not resume automatically.",
                        `Use resume_agent with target ${JSON.stringify(taskName)} to continue it, or interrupt_agent to leave it stopped.`,
                        "</subagent-notification>",
                    ].join("\n"),
                },
            ],
            id: createId(),
            role: "user",
        };
        this.#separateModelContextFromVisibleTranscript();
        this.#storeMessage(this.#messages.length, message, false, runId);
        this.#contextMessages?.push(message);
        this.#lastMessageAt = this.#now();
        this.#append("message_submitted", {
            displayText,
            message,
            runId,
            source: "notification",
        });
        this.#saveSession();
    }

    reset(): ProtocolSession {
        this.#clearMetadataSettlement();
        this.#invalidateSessionMetadata();
        void this.#agentManager?.stopDescendants(this.id);
        void this.abort({ pauseDescendants: false }).catch(() => undefined);
        for (const run of this.#workflowRuns.values()) {
            if (run.state.status === "running") run.controller.abort();
        }
        this.#workflowRuns.clear();
        this.#ensureRuntime().agent.reset();
        this.#status = "idle";
        this.#interruption = undefined;
        this.#restoredActiveRunId = undefined;
        this.#lastSessionRunId = undefined;
        this.#messages = [];
        this.#contextMessages = undefined;
        this.#partialPositions.clear();
        this.#activePartial = undefined;
        this.#pendingSteeringMessages.clear();
        this.#suspendedRunIds.clear();
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

    rewind(messageId: string): RewindSessionResponse {
        if (this.isSubagent()) {
            throw new Error("Subagent histories cannot be rewound.");
        }
        if (this.#activeRun !== undefined || this.#queue.length > 0) {
            throw new Error(
                "Wait for the active response to finish before rewinding this session.",
            );
        }

        const target = this.#messages.find(
            (entry) => !entry.isPartial && entry.message.id === messageId,
        );
        if (target === undefined || target.message.role !== "user") {
            throw new Error("The selected user message is no longer available.");
        }

        void this.#killRuntimeProcesses();
        this.#runtime = undefined;
        this.#mcpLoaded = false;
        this.#mcpServers = [];
        this.#mcpToolNames.clear();
        this.#tools = [];
        this.#messages = this.#messages.filter((entry) => entry.position < target.position);
        this.#invalidateSessionMetadata();
        const retainedRunIds = new Set(
            this.#messages.flatMap((entry) => (entry.runId === undefined ? [] : [entry.runId])),
        );
        this.#latestMetadataBoundaryRunId = findLatestForegroundRunBoundary(
            this.events.since(undefined) ?? [],
            retainedRunIds,
        );
        this.#contextMessages = undefined;
        this.#partialPositions = new Set(
            [...this.#partialPositions].filter((position) => position < target.position),
        );
        this.#activePartial = undefined;
        this.#interruption = undefined;
        this.#lastSessionRunId = undefined;
        this.#restoredActiveRunId = undefined;
        this.#status = "idle";
        this.#lastMessageAt = this.#now();
        this.#persistence?.deleteMessagesFrom(this.id, target.position);
        this.#append("session_rewound", {
            messageId,
            snapshot: this.#agentSnapshot(),
        });
        this.#restartMetadataSettlement();
        return { message: target.message, session: this.snapshot() };
    }

    async compact(signal?: AbortSignal): Promise<AgentCompactionResult> {
        this.#assertAcceptingWork();
        if (this.#activeRun !== undefined || this.#queue.length > 0) {
            throw new Error("Wait for the active response to finish before compacting.");
        }

        const controller = new AbortController();
        this.#compactionController = controller;
        const compactSignal =
            signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal]);
        const previousStatus = this.#status;
        this.#compactionActive = true;
        this.#status = "running";
        this.#restartMetadataSettlement();
        this.#saveSession();
        try {
            const result = await this.#ensureRuntime().agent.compact(compactSignal);
            this.#syncContextMessages();
            return result;
        } finally {
            this.#compactionActive = false;
            if (this.#compactionController === controller) this.#compactionController = undefined;
            if (!this.#closing) {
                this.#status = previousStatus;
                this.#restartMetadataSettlement();
                this.#saveSession();
            }
        }
    }

    isSubagent(): boolean {
        return this.#agentMetadata.type === "subagent";
    }

    recordSubagentChanged(subagent: SubagentSummary): void {
        this.#append("subagent_changed", { subagent });
        this.#restartMetadataSettlement();
    }

    recordDescendantActivity(): void {
        this.#restartMetadataSettlement();
    }

    recordUserActivity(): void {
        this.#restartMetadataSettlement();
    }

    requestForSubagent(): CreateSessionRequest {
        return {
            cwd: this.#request.cwd,
            ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
            ...(this.#serviceTier !== undefined ? { serviceTier: this.#serviceTier } : {}),
            ...(this.#instructions !== undefined ? { instructions: this.#instructions } : {}),
            modelId: this.#modelId,
            providerId: this.#providerId,
            ...(this.#request.apiKey !== undefined ? { apiKey: this.#request.apiKey } : {}),
            permissionMode: this.#permissionMode,
            workflowsEnabled: this.#workflowsEnabled,
            ...(this.#request.docker === undefined ? {} : { docker: this.#request.docker }),
        };
    }

    snapshot(): ProtocolSession {
        const snapshot = this.#agentSnapshot();
        const lastEventId = this.events.lastEventId();
        return {
            id: this.id,
            agentId: this.#agentId,
            cwd: this.#request.cwd,
            environment: summarizeDockerExecution(this.#request.docker),
            providerId: this.#providerId,
            permissionMode: this.#permissionMode,
            modelId: this.#modelId,
            modelLocked: this.#modelLocked(),
            models: this.#models,
            status: this.#status,
            snapshot,
            titleStatus: this.#titleStatus,
            ...(this.#recap !== undefined ? { recap: this.#recap } : {}),
            ...(this.#metadataUpdatedAt !== undefined
                ? { metadataUpdatedAt: this.#metadataUpdatedAt }
                : {}),
            ...(this.#metadataRunId !== undefined ? { metadataRunId: this.#metadataRunId } : {}),
            agent: this.agentMetadata(),
            pendingUserInputs: [...this.#pendingUserInputs.values()].map(
                (pending) => pending.request,
            ),
            mcpServers: this.#mcpServers,
            tasks: this.listTasks(),
            workflowsEnabled: this.#workflowsEnabled,
            workflows: this.listWorkflows(),
            backgroundProcesses: this.#runtime?.context.bash.activeSessions?.() ?? [],
            ...(this.#goal !== undefined ? { goal: { ...this.#goal } } : {}),
            ...(snapshot.effort !== undefined ? { effort: snapshot.effort } : {}),
            ...(snapshot.serviceTier !== undefined ? { serviceTier: snapshot.serviceTier } : {}),
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
            environment: summarizeDockerExecution(this.#request.docker),
            providerId: this.#providerId,
            permissionMode: this.#permissionMode,
            modelId: this.#modelId,
            ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
            ...(this.#serviceTier !== undefined ? { serviceTier: this.#serviceTier } : {}),
            status: this.#status,
            titleStatus: this.#titleStatus,
            ...(this.#recap !== undefined ? { recap: this.#recap } : {}),
            ...(this.#metadataUpdatedAt !== undefined
                ? { metadataUpdatedAt: this.#metadataUpdatedAt }
                : {}),
            ...(this.#metadataRunId !== undefined ? { metadataRunId: this.#metadataRunId } : {}),
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
            ...(this.#activeSince === undefined ? {} : { activeSince: this.#activeSince }),
            agent: this.agentMetadata(),
            agentId: this.#agentId,
            cwd: this.#request.cwd,
            elapsedMs: this.#elapsedMs,
            ...(this.#request.docker === undefined ? {} : { docker: this.#request.docker }),
            ...(contextMessages !== undefined ? { contextMessages: [...contextMessages] } : {}),
            ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
            ...(this.#serviceTier !== undefined ? { serviceTier: this.#serviceTier } : {}),
            id: this.id,
            ...(this.#instructions !== undefined ? { instructions: this.#instructions } : {}),
            ...(this.#goal !== undefined ? { goal: { ...this.#goal } } : {}),
            ...(this.#interruption !== undefined ? { interruption: this.#interruption } : {}),
            ...(this.#lastMessageAt !== undefined ? { lastMessageAt: this.#lastMessageAt } : {}),
            ...(this.#metadataRunId !== undefined ? { metadataRunId: this.#metadataRunId } : {}),
            ...(this.#metadataUpdatedAt !== undefined
                ? { metadataUpdatedAt: this.#metadataUpdatedAt }
                : {}),
            messages: [...this.#messages],
            modelId: this.#modelId,
            models: this.#models,
            providerId: this.#providerId,
            permissionMode: this.#permissionMode,
            queuedRuns: [...this.#queue],
            ...(this.#recap !== undefined ? { recap: this.#recap } : {}),
            nextTaskId: this.#nextTaskId,
            status: this.#status,
            tasks: this.listTasks(),
            ...(this.#title !== undefined ? { title: this.#title } : {}),
            ...(this.#titleError !== undefined ? { titleError: this.#titleError } : {}),
            titleStatus: this.#titleStatus,
            totalTokens: this.#totalTokens,
            tools: this.#tools,
            workflowsEnabled: this.#workflowsEnabled,
            workflows: [...this.#workflowRuns.values()].map((run) => ({
                agentCalls: [...run.agentCalls],
                ...(run.checkpoint === undefined
                    ? {}
                    : {
                          checkpoint: {
                              nextAgentCallIndex: run.checkpoint.nextAgentCallIndex,
                              phase: run.checkpoint.phase,
                              snapshotBase64: Buffer.from(run.checkpoint.snapshot).toString(
                                  "base64",
                              ),
                          },
                      }),
                state: cloneWorkflowRun(run.state),
            })),
        };
        if (activeRunId !== undefined) {
            state.activeRunId = activeRunId;
        }
        return state;
    }

    submit(
        request: SubmitMessageRequest,
        options: { source?: "notification" } = {},
    ): SubmitMessageResponse {
        this.#assertAcceptingWork();
        this.#restartMetadataSettlement();
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
            ...(request.interactive === undefined ? {} : { interactive: request.interactive }),
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
            delivery: "run",
            displayText,
            message: visibleMessage,
            runId,
            ...(options.source === undefined ? {} : { source: options.source }),
        });
        this.#startDrainQueue();
        return {
            eventId: event.id,
            runId,
            sessionId: this.id,
        };
    }

    steer(request: SubmitMessageRequest): SteerMessageResponse {
        this.#assertAcceptingWork();
        this.#restartMetadataSettlement();
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
        const pending = agent.status === "running";
        if (pending) {
            this.#pendingSteeringMessages.set(userMessage.id, {
                message: userMessage,
                runId: activeRun.runId,
            });
            agent.steerMessage(userMessage);
        } else {
            agent.enqueueMessage(userMessage);
            this.#storeMessage(this.#messages.length, userMessage, false, activeRun.runId);
        }
        this.#interruption = undefined;
        this.#lastMessageAt = this.#now();
        const event = this.#append("message_submitted", {
            delivery: "steer",
            displayText,
            message: userMessage,
            runId: activeRun.runId,
        });
        if (!pending) {
            this.#append("steering_applied", {
                messageIds: [userMessage.id],
                runId: activeRun.runId,
            });
        }
        return {
            eventId: event.id,
            runId: activeRun.runId,
            sessionId: this.id,
        };
    }

    deliverNotification(
        request: SubmitMessageRequest,
    ): SubmitMessageResponse | SteerMessageResponse {
        this.#assertAcceptingWork();
        if (this.#activeRun === undefined) {
            return this.submit(request, { source: "notification" });
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

        const pending = agent.status === "running";
        if (pending) {
            this.#pendingSteeringMessages.set(userMessage.id, {
                message: visibleMessage,
                runId: activeRun.runId,
            });
            agent.steerMessage(userMessage);
        } else {
            agent.enqueueMessage(userMessage);
            this.#storeMessage(this.#messages.length, visibleMessage, false, activeRun.runId);
        }
        this.#interruption = undefined;
        const event = this.#append("message_submitted", {
            delivery: "steer",
            displayText,
            message: visibleMessage,
            runId: activeRun.runId,
            source: "notification",
        });
        if (!pending) {
            this.#append("steering_applied", {
                messageIds: [userMessage.id],
                runId: activeRun.runId,
            });
        }
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

        const messages = this.#committedMessages();
        const latestText = limitInspectionText(findLastAgentResponseText(messages));
        const prompt = limitInspectionText(findFirstUserRequestText(messages));
        return {
            ...(this.#activeSince === undefined ? {} : { activeSince: this.#activeSince }),
            agentId: this.#agentId,
            createdAt: this.events.firstCreatedAt() ?? this.#now(),
            depth: this.#agentMetadata.depth,
            description: this.#agentMetadata.description ?? "Delegated task",
            elapsedMs: this.#elapsedMs,
            id: this.id,
            ...(latestText === undefined ? {} : { latestText }),
            modelId: this.#modelId,
            parentSessionId: this.#agentMetadata.parentSessionId,
            ...(this.#agentMetadata.parentToolCallId !== undefined
                ? { parentToolCallId: this.#agentMetadata.parentToolCallId }
                : {}),
            ...(prompt === undefined ? {} : { prompt }),
            status: this.#status,
            ...(this.#agentMetadata.taskName !== undefined
                ? { taskName: this.#agentMetadata.taskName }
                : {}),
            totalTokens: this.#totalTokens,
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
            ...(this.#serviceTier !== undefined ? { serviceTier: this.#serviceTier } : {}),
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

    async #ensureMcpTools(
        runtime: CodingAssistantRuntime,
        signal?: AbortSignal,
        interactive = true,
    ): Promise<void> {
        if (
            this.#mcpLoaded &&
            this.#permissionMode !== "auto" &&
            this.#permissionMode !== "full_access"
        ) {
            return;
        }
        if (this.#mcpToolProvider === undefined) {
            this.#mcpLoaded = true;
            return;
        }

        const permissionMode = this.#permissionMode;
        const mcpLoadOptions =
            !this.isSubagent() &&
            interactive &&
            (permissionMode === "auto" || permissionMode === "full_access")
                ? {
                      requestTrust: (request: McpServerTrustRequest) =>
                          this.#requestMcpTrust(request, signal),
                  }
                : {};
        const loaded = await this.#mcpToolProvider.load(
            this.#request.cwd,
            permissionMode,
            mcpLoadOptions,
        );
        if (this.#permissionMode !== permissionMode) return;
        const baseTools = runtime.agent.tools.filter((tool) => !this.#mcpToolNames.has(tool.name));
        const baseToolNames = new Set(baseTools.map((tool) => tool.name));
        const merged = mergeMcpTools(baseTools, loaded);
        runtime.agent.setTools(merged.tools);
        this.#mcpToolNames = new Set(
            merged.tools.filter((tool) => !baseToolNames.has(tool.name)).map((tool) => tool.name),
        );
        this.#tools = runtime.agent.tools.map((tool) => tool.name);
        const serversChanged = JSON.stringify(this.#mcpServers) !== JSON.stringify(merged.servers);
        this.#mcpServers = merged.servers;
        this.#mcpLoaded = true;
        if (serversChanged && merged.servers.length > 0) {
            this.#append("mcp_servers_changed", { servers: merged.servers });
        }
    }

    async #requestMcpTrust(request: McpServerTrustRequest, signal?: AbortSignal): Promise<boolean> {
        const response = await this.requestUserInput(
            createMcpTrustUserInputRequest(request),
            signal === undefined ? {} : { signal },
        );
        return response.answers.mcp_trust?.includes(MCP_TRUST_ANSWER) === true;
    }

    #removeMcpTools(runtime: CodingAssistantRuntime | undefined): void {
        if (runtime !== undefined && this.#mcpToolNames.size > 0) {
            runtime.agent.setTools(
                runtime.agent.tools.filter((tool) => !this.#mcpToolNames.has(tool.name)),
            );
            this.#tools = runtime.agent.tools.map((tool) => tool.name);
        }
        this.#mcpLoaded = false;
        this.#mcpServers = [];
        this.#mcpToolNames.clear();
        this.#append("mcp_servers_changed", { servers: [] });
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

    #recordWorkflowUpdate(update: WorkflowRunUpdate): void {
        this.#append("workflow_changed", { update });
        this.#restartMetadataSettlement();
    }

    #appendAgentEvent(runId: string, event: AgentLoopEvent): void {
        if (this.#activeRun?.runId !== runId) {
            return;
        }

        if (event.type === "steering_applied") {
            for (const messageId of event.messageIds) {
                const pending = this.#pendingSteeringMessages.get(messageId);
                if (pending === undefined || pending.runId !== runId) continue;
                this.#storeMessage(this.#messages.length, pending.message, false, runId);
                this.#pendingSteeringMessages.delete(messageId);
            }
            this.#append("steering_applied", { messageIds: event.messageIds, runId });
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

        const existingMessage = this.#messages.find(
            (candidate) => !candidate.isPartial && candidate.message.id === message.id,
        );
        const existingPosition = existingMessage?.position;
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
        if (message.role === "agent") {
            const previousTokens =
                existingMessage?.message.role === "agent"
                    ? (existingMessage.message.usage?.totalTokens ?? 0)
                    : 0;
            this.#totalTokens += (message.usage?.totalTokens ?? 0) - previousTokens;
        }
        this.#append("agent_message", { message, runId });
        if (this.isSubagent()) this.#agentManager?.recordChanged(this);
    }

    #appendRunFinished(runId: string, result: AgentRunResult): void {
        const stopReason: StopReason = result.stopReason;
        this.#status =
            stopReason === "aborted"
                ? this.#suspendOnAbort
                    ? "suspended"
                    : "aborted"
                : "completed";
        this.#finishElapsedInterval();
        this.#suspendOnAbort = false;
        this.#activePartial = undefined;
        if (this.#activeRun?.runId === runId) {
            this.#activeRun = undefined;
        }
        this.#discardPendingSteeringMessages(runId);
        this.#append("run_finished", {
            agentRunId: result.runId,
            modelLocked: this.#modelLocked(),
            runId,
            stopReason,
        });
        this.#latestMetadataBoundaryRunId = runId;
        this.#restartMetadataSettlement();
        if (this.isSubagent()) this.#agentManager?.recordChanged(this);
    }

    async #observeProviderQuota(
        provider: Provider,
        runId: string,
        observationId: string,
        phase: "before" | "after",
    ): Promise<void> {
        if (this.isSubagent() || provider.quota === undefined) return;
        try {
            const quota = await provider.quota({ fresh: true });
            this.#append("provider_quota_observed", {
                observationId,
                phase,
                providerId: provider.id,
                quota,
                runId,
            });
        } catch {
            // Quota observation must never fail or replay an otherwise completed agent run.
        }
    }

    #finishElapsedInterval(): void {
        if (this.#activeSince === undefined) return;
        this.#elapsedMs += Math.max(0, this.#now() - this.#activeSince);
        this.#activeSince = undefined;
    }

    #committedMessages(): Message[] {
        return this.#messages
            .filter((message) => !message.isPartial)
            .sort((left, right) => left.position - right.position)
            .map((message) => message.message);
    }

    #discardPendingSteeringMessages(runId: string): void {
        for (const [messageId, pending] of this.#pendingSteeringMessages) {
            if (pending.runId === runId) this.#pendingSteeringMessages.delete(messageId);
        }
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
            sessionId: this.#agentMetadata.rootSessionId,
            tasks: {
                create: (request) => this.#taskSession().createTask(request),
                get: (taskId) => this.#taskSession().getTask(taskId),
                list: () => this.#taskSession().listTasks(),
                update: (taskId, request) => this.#taskSession().updateTask(taskId, request),
            },
        };
        if (this.#workflowsEnabled) {
            options.workflowsEnabled = true;
            options.workflows = {
                get: (runId) => this.getWorkflow(runId),
                launch: (request) => this.launchWorkflow(request),
                stop: (runId) => this.stopWorkflow(runId),
                wait: (runId, signal) => this.waitForWorkflow(runId, signal),
            };
        } else {
            options.workflowsEnabled = false;
        }
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
        if (this.#serviceTier !== undefined) options.serviceTier = this.#serviceTier;
        if (this.#instructions !== undefined) options.instructions = this.#instructions;
        if (this.#request.apiKey !== undefined) options.apiKey = this.#request.apiKey;
        if (this.#request.docker !== undefined) options.docker = this.#request.docker;
        const agentManager = this.#agentManager;
        if (agentManager !== undefined) {
            options.subagents = {
                canSpawn: this.#agentMetadata.depth < agentManager.maxDepth,
                depth: this.#agentMetadata.depth,
                followUp: (target, message) => agentManager.followUp(this.id, target, message),
                interrupt: (target) => agentManager.interrupt(this.id, target),
                list: (pathPrefix) => agentManager.list(this.id, pathPrefix),
                maxDepth: agentManager.maxDepth,
                resume: (target) => agentManager.resume(this.id, target),
                spawn: (request, signal) => agentManager.spawn(this.id, request, signal),
                wait: (timeoutMs, signal) => agentManager.wait(this.id, timeoutMs, signal),
            };
        }
        const runtime = this.#createRuntime(options);
        let previousBackgroundCount = runtime.context.bash.activeSessionCount?.() ?? 0;
        runtime.context.bash.setActiveSessionCountListener?.((running) => {
            const runId = this.#activeRun?.runId ?? this.#lastSessionRunId ?? "background";
            this.#append("agent_event", {
                event: {
                    type: "background_processes_changed",
                    processes: runtime.context.bash.activeSessions?.() ?? [],
                    running,
                },
                runId,
            });
            if (running === previousBackgroundCount) return;
            previousBackgroundCount = running;
            this.#restartMetadataSettlement();
        });
        const snapshot = runtime.agent.snapshot();
        this.#runtime = runtime;
        this.#agentId = snapshot.id;
        this.#providerId = runtime.provider.id;
        this.#modelId = snapshot.modelId;
        this.#effort = snapshot.effort;
        this.#serviceTier = snapshot.serviceTier;
        this.#instructions = snapshot.instructions;
        this.#models = this.#modelsForProvider(this.#providerId);
        this.#tools = snapshot.tools;
        this.#saveSession();
        return runtime;
    }

    #taskSession(): InMemorySession {
        return this.#agentManager?.taskSession(this.id) ?? this;
    }

    #activeProcessCount(): number {
        const runtime = this.#runtime;
        const nativeProcesses = runtime?.processManager.activeCount() ?? 0;
        return this.#request.docker === undefined
            ? nativeProcesses
            : nativeProcesses + (runtime?.context.bash.activeSessionCount?.() ?? 0);
    }

    async #killRuntimeProcesses(forceAfterMs = 500): Promise<void> {
        const runtime = this.#runtime;
        if (runtime === undefined) return;
        await runtime.processManager.killAll({ forceAfterMs });
        if (this.#request.docker !== undefined) await runtime.context.bash.killAllSessions?.();
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

    #providerSupportsServiceTier(providerId: string, serviceTier: ServiceTier): boolean {
        return (
            this.#modelCatalog.providers
                .find((provider) => provider.providerId === providerId)
                ?.serviceTiers?.includes(serviceTier) === true
        );
    }

    #clearMetadataSettlement(): void {
        this.#metadataRevision += 1;
        this.#metadataDelayCancel?.();
        this.#metadataDelayCancel = undefined;
        this.#metadataController?.abort();
        this.#metadataController = undefined;
        if (this.#titleStatus === "generating") {
            this.#titleStatus = this.#title === undefined ? "idle" : "ready";
            this.#titleError = undefined;
            this.#saveSession();
        }
    }

    #invalidateSessionMetadata(): void {
        this.#latestMetadataBoundaryRunId = undefined;
        this.#metadataRunId = undefined;
        this.#metadataUpdatedAt = undefined;
        this.#recap = undefined;
        this.#title = this.#agentMetadata.description;
        this.#titleError = undefined;
        this.#titleStatus = this.#title === undefined ? "idle" : "ready";
    }

    #restartMetadataSettlement(): void {
        this.#clearMetadataSettlement();
        if (this.#closing || this.#taskDrain?.closing === true) return;
        if (this.isSubagent()) {
            this.#agentManager?.recordDescendantSettlementActivity(
                this.#agentMetadata.rootSessionId,
            );
            return;
        }
        if (
            this.#latestMetadataBoundaryRunId === undefined ||
            this.#latestMetadataBoundaryRunId === this.#metadataRunId ||
            !this.#isMetadataSettlementIdle()
        ) {
            return;
        }

        const revision = this.#metadataRevision;
        const waitAndSettle = () => this.#waitAndSettleMetadata(revision);
        const settlement = this.#taskDrain?.run(waitAndSettle) ?? waitAndSettle();
        void settlement.catch(() => undefined);
    }

    async #waitAndSettleMetadata(revision: number): Promise<void> {
        if (revision !== this.#metadataRevision || this.#closing) return;
        await new Promise<void>((resolve) => {
            if (revision !== this.#metadataRevision || this.#closing) {
                resolve();
                return;
            }

            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                if (this.#metadataTimer === timer) this.#metadataTimer = undefined;
                if (this.#metadataDelayCancel === cancel) {
                    this.#metadataDelayCancel = undefined;
                }
                resolve();
            };
            const timer = setTimeout(finish, SESSION_SETTLEMENT_DELAY_MS);
            const cancel = () => {
                clearTimeout(timer);
                finish();
            };
            this.#metadataTimer = timer;
            this.#metadataDelayCancel = cancel;
            timer.unref?.();
        });
        if (revision !== this.#metadataRevision || this.#closing) return;
        await this.#settleMetadata(revision);
    }

    #isMetadataSettlementIdle(): boolean {
        return (
            !this.hasLocalSettlementWork() && !this.#agentManager?.hasActiveDescendantWork(this.id)
        );
    }

    async #settleMetadata(revision: number): Promise<void> {
        const runId = this.#latestMetadataBoundaryRunId;
        const transcript = createSessionMetadataTranscript(
            this.#messages,
            this.events.since(undefined) ?? [],
        );
        if (
            revision !== this.#metadataRevision ||
            runId === undefined ||
            runId === this.#metadataRunId ||
            transcript === undefined ||
            !this.#isMetadataSettlementIdle()
        ) {
            return;
        }

        const controller = new AbortController();
        this.#metadataController = controller;
        this.#titleStatus = "generating";
        this.#titleError = undefined;
        this.#append("session_title_changed", { status: this.#titleStatus });
        try {
            const metadata = await generateSessionMetadata({
                ...(this.#title === undefined ? {} : { currentTitle: this.#title }),
                now: this.#now,
                provider: this.#ensureRuntime().provider,
                sessionId: this.id,
                signal: controller.signal,
                transcript,
            });
            if (
                controller.signal.aborted ||
                revision !== this.#metadataRevision ||
                runId !== this.#latestMetadataBoundaryRunId ||
                !this.#isMetadataSettlementIdle()
            ) {
                return;
            }
            const metadataUpdatedAt = this.#now();
            this.#title = metadata.title;
            this.#recap = metadata.recap;
            this.#metadataRunId = runId;
            this.#metadataUpdatedAt = metadataUpdatedAt;
            this.#titleStatus = "ready";
            this.#titleError = undefined;
            this.#append("session_title_changed", {
                metadataRunId: runId,
                metadataUpdatedAt,
                recap: metadata.recap,
                status: this.#titleStatus,
                title: metadata.title,
            });
        } catch (error) {
            if (controller.signal.aborted || revision !== this.#metadataRevision) return;
            this.#titleStatus = "error";
            this.#titleError = error instanceof Error ? error.message : String(error);
            this.#append("session_title_changed", {
                errorMessage: this.#titleError,
                status: this.#titleStatus,
            });
        } finally {
            if (this.#metadataController === controller) this.#metadataController = undefined;
        }
    }

    async #runQueued(queued: PersistedQueuedRun): Promise<void> {
        let controller = new AbortController();
        this.#activeRun = { controller, kind: queued.kind, runId: queued.runId };
        this.#lastSessionRunId = queued.runId;
        this.#restoredActiveRunId = undefined;
        this.#status = "running";
        this.#activeSince ??= this.#now();
        this.#append("run_started", { runId: queued.runId });
        if (this.isSubagent()) this.#agentManager?.recordChanged(this);

        let runtime: CodingAssistantRuntime | undefined;
        const quotaObservationId = createId();
        try {
            runtime = this.#ensureRuntime();
            await this.#ensureMcpTools(runtime, controller.signal, queued.interactive !== false);
            await this.#observeProviderQuota(
                runtime.provider,
                queued.runId,
                quotaObservationId,
                "before",
            );
            runtime.agent.enqueueMessage(queued.userMessage);
            if (this.#contextMessages !== undefined) {
                this.#contextMessages = [...this.#contextMessages, queued.userMessage];
                this.#saveSession();
            }
            for (;;) {
                const result = await runtime.agent.run({
                    signal: controller.signal,
                    onEvent: (event) => this.#appendAgentEvent(queued.runId, event),
                    onMessage: (message) => this.#appendAgentMessage(queued.runId, message),
                });
                if (this.#activeRun?.runId !== queued.runId) {
                    return;
                }

                const continuation = this.#pendingSteeringContinuations.get(queued.runId);
                if (result.stopReason === "aborted" && continuation !== undefined) {
                    await continuation.ready;
                    if (
                        !continuation.cancelled &&
                        this.#pendingSteeringContinuations.get(queued.runId) === continuation &&
                        this.#activeRun?.runId === queued.runId
                    ) {
                        this.#pendingSteeringContinuations.delete(queued.runId);
                        controller = new AbortController();
                        this.#activeRun = {
                            controller,
                            kind: queued.kind,
                            runId: queued.runId,
                        };
                        this.#activePartial = undefined;
                        continue;
                    }
                    this.#pendingSteeringContinuations.delete(queued.runId);
                }

                await this.#observeProviderQuota(
                    runtime.provider,
                    queued.runId,
                    quotaObservationId,
                    "after",
                );
                this.#appendRunFinished(queued.runId, result);
                if (result.stopReason !== "aborted" && result.stopReason !== "error") {
                    this.#continueGoalIfIdle();
                }
                break;
            }
        } catch (error) {
            if (this.#activeRun?.runId !== queued.runId) {
                return;
            }
            this.#status =
                controller.signal.aborted && this.#suspendOnAbort ? "suspended" : "error";
            this.#finishElapsedInterval();
            this.#suspendOnAbort = false;
            this.#activePartial = undefined;
            this.#discardPendingSteeringMessages(queued.runId);
            this.#pauseActiveGoal();
            if (this.#activeRun?.runId === queued.runId) {
                this.#activeRun = undefined;
            }
            if (runtime !== undefined) {
                await this.#observeProviderQuota(
                    runtime.provider,
                    queued.runId,
                    quotaObservationId,
                    "after",
                );
            }
            this.#append("run_error", {
                errorMessage: error instanceof Error ? error.message : String(error),
                modelLocked: this.#modelLocked(),
                runId: queued.runId,
            });
            this.#latestMetadataBoundaryRunId = queued.runId;
            this.#restartMetadataSettlement();
            if (this.isSubagent()) this.#agentManager?.recordChanged(this);
        } finally {
            this.#pendingSteeringContinuations.delete(queued.runId);
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

        const drain = () => this.#drainQueue();
        const draining = this.#taskDrain?.run(drain) ?? drain();
        this.#draining = draining.finally(() => {
            this.#draining = undefined;
        });
        void this.#draining.catch(() => undefined);
    }

    #assertAcceptingWork(): void {
        if (this.#closing || this.#taskDrain?.closing === true) {
            throw new Error("The local daemon is shutting down.");
        }
    }

    #continueGoalIfIdle(): void {
        if (
            this.#closing ||
            this.#taskDrain?.closing === true ||
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
        const message = assistantMessageToAgentMessage(partial, () => activePartial.fallbackId, {
            providerId: this.#providerId,
            requestedModelId: this.#modelId,
        });
        this.#storeMessage(position, message, true, runId);
    }
}

function cloneWorkflowRun(run: WorkflowRun): WorkflowRun {
    return {
        ...run,
        logs: [...run.logs],
    };
}

function limitInspectionText(text: string | undefined): string | undefined {
    if (text === undefined || text.length <= MAX_SUBAGENT_INSPECTION_TEXT_CHARS) return text;
    return `${text.slice(0, MAX_SUBAGENT_INSPECTION_TEXT_CHARS - 1)}…`;
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

function findLatestForegroundRunBoundary(
    events: readonly SessionEvent[],
    retainedRunIds?: ReadonlySet<string>,
): string | undefined {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (
            (event?.type === "run_finished" || event?.type === "run_error") &&
            (retainedRunIds === undefined || retainedRunIds.has(event.data.runId))
        ) {
            return event.data.runId;
        }
    }
    return undefined;
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
