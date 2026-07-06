import type { AgentLoopEvent, AgentSnapshot } from "../agent/index.js";
import type { Message, UserMessage } from "../agent/types.js";
import type { Model, StopReason } from "../providers/types.js";
import type { EventId } from "./EventId.js";

export type SessionStatus = "idle" | "queued" | "running" | "completed" | "aborted" | "error";

export type SessionTitleStatus = "idle" | "generating" | "ready" | "error";

export type SessionInterruptionReason = "crash" | "shutdown";

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
    snapshot: AgentSnapshot;
}

export interface SessionSummary {
    id: string;
    cwd: string;
    providerId: string;
    modelId: string;
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
}

export interface CreateSessionResponse {
    session: ProtocolSession;
}

export interface ListSessionsResponse {
    sessions: readonly SessionSummary[];
}

export interface ShutdownServerResponse {
    shuttingDown: boolean;
}

export interface SubmitMessageRequest {
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
    | EffortChangedEvent;

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
