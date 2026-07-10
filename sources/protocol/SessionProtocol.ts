import type {
    AgentCompactionResult,
    AgentLoopEvent,
    AgentSnapshot,
    ContentBlock,
} from "../agent/index.js";
import type { Message, UserMessage } from "../agent/types.js";
import type { Model, StopReason } from "../providers/types.js";
import type { PermissionMode } from "../permissions/index.js";
import type { UserInputRequest, UserInputResponse } from "../user-input/index.js";
import type { McpServerSummary } from "../mcp/index.js";
import type { SessionTask } from "../tasks/index.js";
import type { EventId } from "./EventId.js";

export type SessionStatus = "idle" | "queued" | "running" | "completed" | "aborted" | "error";

export type SessionTitleStatus = "idle" | "generating" | "ready" | "error";

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
}

export interface ModelCatalog {
    defaultModelId: string;
    defaultProviderId: string;
    models: readonly Model[];
    providers: readonly ProviderModelCatalog[];
}

export type ServerInitializationStatus = "starting" | "ready" | "error";

export interface HealthResponse {
    catalog?: ModelCatalog;
    errorMessage?: string;
    healthy: boolean;
    ready: boolean;
    status: ServerInitializationStatus;
}

export interface ListModelsResponse {
    catalog: ModelCatalog;
}

export interface ProtocolSession {
    id: string;
    agentId: string;
    cwd: string;
    providerId: string;
    permissionMode: PermissionMode;
    modelId: string;
    effort?: string;
    modelLocked: boolean;
    models: readonly Model[];
    status: SessionStatus;
    title?: string;
    titleError?: string;
    titleStatus: SessionTitleStatus;
    interruption?: SessionInterruption;
    lastEventId?: EventId;
    agent: SessionAgentMetadata;
    snapshot: AgentSnapshot;
    pendingUserInputs: readonly UserInputRequest[];
    mcpServers: readonly McpServerSummary[];
    tasks: readonly SessionTask[];
}

export interface SubagentSummary {
    agentId: string;
    createdAt: number;
    depth: number;
    description: string;
    id: string;
    modelId: string;
    parentSessionId: string;
    parentToolCallId?: string;
    status: SessionStatus;
    taskName?: string;
    updatedAt: number;
}

export interface SessionSummary {
    id: string;
    cwd: string;
    providerId: string;
    modelId: string;
    permissionMode: PermissionMode;
    effort?: string;
    status: SessionStatus;
    title?: string;
    titleError?: string;
    titleStatus: SessionTitleStatus;
    createdAt: number;
    updatedAt: number;
    lastMessageAt?: number;
    interruption?: SessionInterruption;
}

export interface CreateSessionRequest {
    apiKey?: string;
    cwd: string;
    effort?: string;
    instructions?: string;
    modelId?: string;
    providerId?: string;
    permissionMode?: PermissionMode;
}

export interface ChangePermissionModeRequest {
    permissionMode: PermissionMode;
}

export type AnswerUserInputRequest = UserInputResponse;

export interface CreateSessionResponse {
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

export interface FileSearchResult {
    fileName: string;
    path: string;
}

export interface SearchFilesResponse {
    files: readonly FileSearchResult[];
}

export interface ShutdownServerResponse {
    shuttingDown: boolean;
}

export interface SubmitMessageRequest {
    content?: readonly ContentBlock[];
    displayText?: string;
    text: string;
}

export interface SubmitMessageResponse {
    eventId: EventId;
    runId: string;
    sessionId: string;
}

export interface ChangeModelRequest {
    effort?: string;
    modelId: string;
    providerId?: string;
}

export interface ChangeEffortRequest {
    effort?: string;
}

export interface AbortRunResponse {
    aborted: boolean;
    eventId?: EventId;
}

export type SessionEvent =
    | SessionCreatedEvent
    | MessageSubmittedEvent
    | RunStartedEvent
    | AgentStreamEvent
    | AgentMessageEvent
    | RunFinishedEvent
    | RunErrorEvent
    | AbortRequestedEvent
    | SessionResetEvent
    | SessionTitleChangedEvent
    | ModelChangedEvent
    | EffortChangedEvent
    | PermissionModeChangedEvent
    | UserInputRequestedEvent
    | UserInputResolvedEvent
    | McpServersChangedEvent
    | TasksChangedEvent
    | SubagentChangedEvent;

export interface BaseSessionEvent<TType extends string, TData> {
    createdAt: number;
    data: TData;
    id: EventId;
    sessionId: string;
    type: TType;
}

export type SessionCreatedEvent = BaseSessionEvent<"session_created", { session: ProtocolSession }>;

export type MessageSubmittedEvent = BaseSessionEvent<
    "message_submitted",
    {
        displayText: string;
        message: UserMessage;
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
        runId: string;
        stopReason: StopReason;
    }
>;

export type RunErrorEvent = BaseSessionEvent<
    "run_error",
    {
        errorMessage: string;
        runId: string;
    }
>;

export type AbortRequestedEvent = BaseSessionEvent<
    "abort_requested",
    {
        runId?: string;
    }
>;

export type SessionResetEvent = BaseSessionEvent<"session_reset", { snapshot: AgentSnapshot }>;

export type SessionTitleChangedEvent = BaseSessionEvent<
    "session_title_changed",
    {
        errorMessage?: string;
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

export type PermissionModeChangedEvent = BaseSessionEvent<
    "permission_mode_changed",
    { permissionMode: PermissionMode }
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

export type SubagentChangedEvent = BaseSessionEvent<
    "subagent_changed",
    {
        subagent: SubagentSummary;
    }
>;
