import type {
    AgentCompactionResult,
    AgentLoopEvent,
    AgentSnapshot,
    ContentBlock,
} from "../agent/index.js";
import type { Message, UserMessage } from "../agent/types.js";
import type { Model, ServiceTier, StopReason, Usage } from "../providers/types.js";
import type { ProviderQuota } from "../providers/providerQuota.js";
import type { PermissionMode } from "../permissions/index.js";
import type { UserInputRequest, UserInputResponse } from "../user-input/index.js";
import type { McpServerSummary } from "../mcp/index.js";
import type { SessionTask } from "../tasks/index.js";
import type { WorkflowRun, WorkflowRunUpdate } from "../workflows/index.js";
import type { ChangeGoalStatusRequest, CreateGoalRequest, SessionGoal } from "../goals/index.js";
import type { EventId } from "./EventId.js";
import type { DockerExecutionConfig } from "../execution/DockerExecutionConfig.js";
import type { SessionExecutionEnvironment } from "../execution/SessionExecutionEnvironment.js";
import type { BashSessionActivity } from "../agent/context/BashContext.js";
import type {
    SecretAttachmentScope,
    SecretReference,
    SecretRegistration,
} from "../secrets/index.js";
import type {
    ExternalToolCall,
    ExternalToolCallResolution,
    ExternalToolDefinition,
    ResolveExternalToolCallResponse,
} from "../external-tools/index.js";
import type { DurableSkillDefinition } from "../external-skills/index.js";

export type SessionStatus =
    | "idle"
    | "queued"
    | "running"
    | "completed"
    | "aborted"
    | "suspended"
    | "error";

export type SessionTitleStatus = "idle" | "generating" | "ready" | "error";

export type { SessionExecutionEnvironment } from "../execution/SessionExecutionEnvironment.js";

export type SessionInterruptionReason = "crash" | "shutdown";

export type SessionAgentType = "primary" | "subagent";

export interface SessionAgentMetadata {
    depth: number;
    rootSessionId: string;
    type: SessionAgentType;
    description?: string;
    parentSessionId?: string;
    parentToolCallId?: string;
    taskName?: string;
}

export interface SessionInterruption {
    interruptedAt: number;
    message: string;
    reason: SessionInterruptionReason;
    runId?: string;
}

export interface ProviderModelCatalog {
    providerId: string;
    models: readonly Model[];
    serviceTiers?: readonly ServiceTier[];
}

export interface ModelCatalog {
    defaultModelId: string;
    defaultProviderId: string;
    models: readonly Model[];
    providers: readonly ProviderModelCatalog[];
}

export interface DaemonIdentity {
    version: string;
    developmentBuildId?: string;
}

export interface ReadyHealthResponse {
    catalog: ModelCatalog;
    durableGlobalEventQueue: boolean;
    healthy: true;
    identity: DaemonIdentity;
    ready: true;
    status: "ready";
}

export interface StartingHealthResponse {
    healthy: true;
    identity: DaemonIdentity;
    ready: false;
    status: "starting";
}

export interface ErrorHealthResponse {
    error: string;
    healthy: false;
    identity: DaemonIdentity;
    ready: false;
    status: "error";
}

export type HealthResponse = ErrorHealthResponse | ReadyHealthResponse | StartingHealthResponse;

export interface ListModelsResponse {
    catalog: ModelCatalog;
}

export interface DaemonConfig {
    settings: {
        durableGlobalEventQueue: boolean;
    };
}

export interface GetDaemonConfigResponse {
    config: DaemonConfig;
}

export interface UpdateDaemonConfigRequest {
    settings: {
        durableGlobalEventQueue: boolean;
    };
}

export type UpdateDaemonConfigResponse = GetDaemonConfigResponse;

export interface ProtocolSession {
    id: string;
    agentId: string;
    appendSystemPrompt?: string;
    cwd: string;
    providerId: string;
    permissionMode: PermissionMode;
    modelId: string;
    effort?: string;
    serviceTier?: ServiceTier;
    secretIds: readonly string[];
    projectSecretIds: readonly string[];
    sessionSecretIds: readonly string[];
    environment?: SessionExecutionEnvironment;
    modelLocked: boolean;
    models: readonly Model[];
    status: SessionStatus;
    title?: string;
    titleError?: string;
    titleStatus: SessionTitleStatus;
    recap?: string;
    metadataUpdatedAt?: number;
    metadataRunId?: string;
    interruption?: SessionInterruption;
    lastEventId?: EventId;
    agent: SessionAgentMetadata;
    snapshot: AgentSnapshot;
    pendingUserInputs: readonly UserInputRequest[];
    mcpServers: readonly McpServerSummary[];
    tasks: readonly SessionTask[];
    workflowsEnabled?: boolean;
    workflows?: readonly WorkflowRun[];
    goal?: SessionGoal;
    backgroundProcesses?: readonly BashSessionActivity[];
    externalTools?: readonly ExternalToolDefinition[];
    skills?: readonly DurableSkillDefinition[];
    pendingExternalToolCalls?: readonly ExternalToolCall[];
    systemPrompt?: string;
}

export interface SubagentSummary {
    activeSince?: number;
    agentId: string;
    createdAt: number;
    depth: number;
    description: string;
    elapsedMs?: number;
    id: string;
    latestText?: string;
    modelId: string;
    parentSessionId: string;
    parentToolCallId?: string;
    prompt?: string;
    status: SessionStatus;
    taskName?: string;
    totalTokens?: number;
    updatedAt: number;
}

export interface SessionSummary {
    id: string;
    cwd: string;
    providerId: string;
    modelId: string;
    permissionMode: PermissionMode;
    effort?: string;
    serviceTier?: ServiceTier;
    environment?: SessionExecutionEnvironment;
    status: SessionStatus;
    title?: string;
    titleError?: string;
    titleStatus: SessionTitleStatus;
    recap?: string;
    metadataUpdatedAt?: number;
    metadataRunId?: string;
    createdAt: number;
    updatedAt: number;
    lastMessageAt?: number;
    interruption?: SessionInterruption;
}

export interface CreateSessionRequest {
    apiKey?: string;
    appendSystemPrompt?: string;
    cwd: string;
    effort?: string;
    serviceTier?: ServiceTier;
    instructions?: string;
    modelId?: string;
    providerId?: string;
    permissionMode?: PermissionMode;
    secretIds?: readonly string[];
    workflowsEnabled?: boolean;
    docker?: DockerExecutionConfig;
    local?: boolean;
}

export interface UpdateSessionRequest {
    appendSystemPrompt: string | null;
}

export interface ChangePermissionModeRequest {
    permissionMode: PermissionMode;
}

export interface AttachSecretRequest {
    secretId: string;
    scope?: SecretAttachmentScope;
}

export interface SecretSessionResponse {
    session: ProtocolSession;
}

export type RegisterSecretRequest = SecretRegistration;
export type SecretSummary = SecretReference;

export interface ListSecretsResponse {
    secrets: readonly SecretSummary[];
}

export interface RegisterSecretResponse {
    secret: SecretSummary;
}

export interface UnregisterSecretResponse {
    removed: boolean;
}

export type SetGoalRequest = CreateGoalRequest;

export type ChangeSessionGoalStatusRequest = ChangeGoalStatusRequest;

export interface GoalSessionResponse {
    session: ProtocolSession;
}

export type AnswerUserInputRequest = UserInputResponse;

export interface CreateSessionResponse {
    session: ProtocolSession;
}

export interface ForkSessionResponse {
    session: ProtocolSession;
}

export interface RewindSessionRequest {
    messageId: string;
}

export interface RewindSessionResponse {
    message: UserMessage;
    session: ProtocolSession;
}

export interface CompactSessionResponse {
    result: AgentCompactionResult;
    session: ProtocolSession;
}

export interface ListSessionsResponse {
    sessions: readonly SessionSummary[];
}

export interface ListSubagentsResponse {
    subagents: readonly SubagentSummary[];
}

export interface SessionUsageGroup {
    kind: "attributed";
    modelId: string;
    providerId: string;
    requestedModelId: string;
    usage: Usage;
    responseModel?: string;
}

export interface SessionContextUsage {
    approximate: boolean;
    modelId: string;
    providerId: string;
    requestedModelId: string;
    responseModel?: string;
    totalTokens: number;
}

export interface GetSessionUsageResponse {
    currentProviderId: string;
    groups: readonly SessionUsageGroup[];
    context?: SessionContextUsage;
    observedQuota: readonly SessionQuotaContribution[];
    quotas: readonly SessionProviderQuota[];
}

export interface GetCurrentProviderQuotaResponse {
    currentProviderId: string;
    quota?: ProviderQuota;
}

export interface SessionProviderQuota {
    providerId: string;
    quota: ProviderQuota;
}

export interface SessionQuotaContribution {
    providerId: string;
    windows: {
        fiveHour?: SessionQuotaWindowContribution;
        weekly?: SessionQuotaWindowContribution;
    };
}

export interface SessionQuotaWindowContribution {
    observedUsedPercent: number;
}

export interface StopWorkflowResponse {
    workflow: WorkflowRun;
}

export interface FileSearchResult {
    fileName: string;
    path: string;
}

export interface SearchFilesResponse {
    files: readonly FileSearchResult[];
}

export interface ShutdownServerResponse {
    pid?: number;
    shuttingDown: boolean;
}

export interface GlobalEventQueueEntry {
    cursor: number;
    event: SessionEvent;
}

export interface ListGlobalEventsResponse {
    events: readonly GlobalEventQueueEntry[];
}

export interface ListExternalToolCallsResponse {
    calls: readonly ExternalToolCall[];
}

export interface TrimGlobalEventsRequest {
    through: number;
}

export interface TrimGlobalEventsResponse {
    trimmed: number;
    through: number;
}

export interface SubmitMessageRequest {
    content?: readonly ContentBlock[];
    debug?: boolean;
    displayText?: string;
    interactive?: boolean;
    /** Replaces the external function set for this and subsequent runs when present. */
    externalTools?: readonly ExternalToolDefinition[];
    /** Replaces the integration-owned durable skill set when present. */
    skills?: readonly DurableSkillDefinition[];
    /** Replaces Rig's assembled system prompt. Null restores Rig's normal prompt. */
    systemPrompt?: string | null;
    text: string;
}

export interface BroadcastMessageRequest extends SubmitMessageRequest {
    all?: boolean;
    sessionIds?: readonly string[];
}

export interface BroadcastMessageResponse {
    submissions: readonly SubmitMessageResponse[];
}

export type ResolveExternalToolCallRequest = ExternalToolCallResolution;
export type { ResolveExternalToolCallResponse };

export interface SubmitMessageResponse {
    debugDirectory?: string;
    eventId: EventId;
    runId: string;
    sessionId: string;
}

export interface RecordSessionActivityResponse {
    recorded: true;
}

export interface SteerMessageRequest extends SubmitMessageRequest {
    clientSubmissionId?: string;
    expectedRunId?: string;
}
export type SteerMessageResponse = SubmitMessageResponse;

export interface ChangeModelRequest {
    effort?: string;
    modelId: string;
    providerId?: string;
}

export interface ChangeEffortRequest {
    effort?: string;
}

export interface ChangeServiceTierRequest {
    serviceTier?: ServiceTier;
}

export interface AbortRunResponse {
    aborted: boolean;
    continued?: boolean;
    eventId?: EventId;
    stoppedProcesses?: number;
}

export interface AbortRunOptions {
    continuePendingSteering?: boolean;
    expectedRunId?: string;
    steeringMessageIds?: readonly string[];
}

export type SessionEvent =
    | SessionCreatedEvent
    | SessionUpdatedEvent
    | MessageSubmittedEvent
    | SteeringAppliedEvent
    | RunStartedEvent
    | AgentStreamEvent
    | AgentMessageEvent
    | RunFinishedEvent
    | ProviderQuotaObservedEvent
    | RunErrorEvent
    | AbortRequestedEvent
    | SessionResetEvent
    | SessionRewoundEvent
    | SessionTitleChangedEvent
    | ModelChangedEvent
    | EffortChangedEvent
    | ServiceTierChangedEvent
    | PermissionModeChangedEvent
    | SecretsChangedEvent
    | UserInputRequestedEvent
    | UserInputResolvedEvent
    | McpServersChangedEvent
    | TasksChangedEvent
    | GoalChangedEvent
    | SubagentChangedEvent
    | SubagentsSuspendedEvent
    | WorkflowChangedEvent
    | ExternalToolCallRequestedEvent
    | ExternalToolCallResolvedEvent;

export interface BaseSessionEvent<TType extends string, TData> {
    createdAt: number;
    data: TData;
    id: EventId;
    sessionId: string;
    type: TType;
}

export type SessionCreatedEvent = BaseSessionEvent<"session_created", { session: ProtocolSession }>;

export type SessionUpdatedEvent = BaseSessionEvent<"session_updated", { session: ProtocolSession }>;

export type MessageSubmittedEvent = BaseSessionEvent<
    "message_submitted",
    {
        displayText: string;
        delivery?: "run" | "steer";
        message: UserMessage;
        runId: string;
        source?: "notification";
    }
>;

export type SteeringAppliedEvent = BaseSessionEvent<
    "steering_applied",
    {
        messageIds: readonly string[];
        runId: string;
    }
>;

export type RunStartedEvent = BaseSessionEvent<"run_started", { runId: string }>;

export type AgentStreamEvent = BaseSessionEvent<
    "agent_event",
    {
        event: AgentLoopEvent;
        runId: string;
    }
>;

export type AgentMessageEvent = BaseSessionEvent<
    "agent_message",
    {
        message: Message;
        runId: string;
    }
>;

export type RunFinishedEvent = BaseSessionEvent<
    "run_finished",
    {
        agentRunId?: string;
        modelLocked: boolean;
        runId: string;
        stopReason: StopReason;
    }
>;

export type ProviderQuotaObservedEvent = BaseSessionEvent<
    "provider_quota_observed",
    {
        observationId: string;
        phase: "before" | "after";
        providerId: string;
        quota: ProviderQuota;
        runId: string;
    }
>;

export type RunErrorEvent = BaseSessionEvent<
    "run_error",
    {
        errorMessage: string;
        modelLocked: boolean;
        runId: string;
        startupInterruption?: true;
    }
>;

export type AbortRequestedEvent = BaseSessionEvent<
    "abort_requested",
    {
        runId?: string;
    }
>;

export type SubagentsSuspendedEvent = BaseSessionEvent<
    "subagents_suspended",
    {
        displayText: string;
    }
>;

export type SessionResetEvent = BaseSessionEvent<"session_reset", { snapshot: AgentSnapshot }>;

export type SessionRewoundEvent = BaseSessionEvent<
    "session_rewound",
    {
        messageId: string;
        snapshot: AgentSnapshot;
    }
>;

export type SessionTitleChangedEvent = BaseSessionEvent<
    "session_title_changed",
    {
        errorMessage?: string;
        metadataRunId?: string;
        metadataUpdatedAt?: number;
        recap?: string;
        status: SessionTitleStatus;
        title?: string;
    }
>;

export type ModelChangedEvent = BaseSessionEvent<
    "model_changed",
    {
        effort?: string;
        modelId: string;
        snapshot: AgentSnapshot;
    }
>;

export type EffortChangedEvent = BaseSessionEvent<
    "effort_changed",
    {
        effort?: string;
        modelId: string;
        snapshot: AgentSnapshot;
    }
>;

export type ServiceTierChangedEvent = BaseSessionEvent<
    "service_tier_changed",
    {
        serviceTier: ServiceTier | null;
        snapshot: AgentSnapshot;
    }
>;

export type PermissionModeChangedEvent = BaseSessionEvent<
    "permission_mode_changed",
    { permissionMode: PermissionMode }
>;

export type SecretsChangedEvent = BaseSessionEvent<
    "secrets_changed",
    {
        projectSecretIds: readonly string[];
        secretIds: readonly string[];
        sessionSecretIds: readonly string[];
    }
>;

export type UserInputRequestedEvent = BaseSessionEvent<"user_input_requested", UserInputRequest>;

export type UserInputResolvedEvent = BaseSessionEvent<
    "user_input_resolved",
    {
        answers?: UserInputResponse["answers"];
        requestId: string;
        status: "answered" | "cancelled";
    }
>;

export type McpServersChangedEvent = BaseSessionEvent<
    "mcp_servers_changed",
    { servers: readonly McpServerSummary[] }
>;

export type TasksChangedEvent = BaseSessionEvent<
    "tasks_changed",
    { tasks: readonly SessionTask[] }
>;

export type GoalChangedEvent = BaseSessionEvent<"goal_changed", { goal: SessionGoal | null }>;

export type SubagentChangedEvent = BaseSessionEvent<
    "subagent_changed",
    {
        subagent: SubagentSummary;
    }
>;

export type WorkflowChangedEvent = BaseSessionEvent<
    "workflow_changed",
    {
        update: WorkflowRunUpdate;
    }
>;

export type ExternalToolCallRequestedEvent = BaseSessionEvent<
    "external_tool_call_requested",
    { call: ExternalToolCall }
>;

export type ExternalToolCallResolvedEvent = BaseSessionEvent<
    "external_tool_call_resolved",
    { call: ExternalToolCall }
>;
