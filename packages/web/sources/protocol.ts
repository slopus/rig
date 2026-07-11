/**
 * Hand-copied mirror of the daemon protocol types.
 *
 * Sources of truth (do not import from them — the web bundle is standalone):
 * - packages/rig/sources/protocol/SessionProtocol.ts
 * - packages/rig/sources/protocol/EventId.ts
 * - packages/rig/sources/agent/types.ts
 * - packages/rig/sources/agent/Agent.ts (AgentSnapshot)
 * - packages/rig/sources/agent/loop.ts (AgentLoopEvent)
 * - packages/rig/sources/providers/types.ts (AssistantMessage streaming shapes)
 */

// ---------------------------------------------------------------------------
// Event ids
// ---------------------------------------------------------------------------

export type EventId = string;

// ---------------------------------------------------------------------------
// Agent transcript blocks and messages (packages/rig/sources/agent/types.ts)
// ---------------------------------------------------------------------------

/** Plain text content. */
export interface TextBlock {
    type: "text";
    text: string;
}

/** Image content, typically base64-encoded. */
export interface ImageBlock {
    type: "image";
    mediaType: string;
    data: string;
}

/** Blocks allowed on system and user messages. */
export type ContentBlock = TextBlock | ImageBlock;

/** Model reasoning content returned by providers that expose thinking blocks. */
export interface ThinkingBlock {
    type: "thinking";
    thinking: string;
    encrypted?: string;
    redacted?: boolean;
}

/** A model-requested tool invocation embedded in a message. */
export interface ToolCallBlock {
    type: "tool_call";
    id: string;
    name: string;
    arguments: unknown;
}

/** Result of executing a tool call, embedded in an agent message. */
export interface ToolResultBlock {
    type: "tool_result";
    toolCallId: string;
    toolName: string;
    /** Rendered tool answer produced by the tool's `toLLM` serializer. */
    rendered: readonly ContentBlock[];
    /** Short human-facing tool summary produced by the tool's `toUI` serializer. */
    display: string;
    isError?: boolean;
}

/** Blocks allowed on agent messages. */
export type AgentBlock = ContentBlock | ThinkingBlock | ToolCallBlock | ToolResultBlock;

export interface SystemMessage {
    role: "system";
    id: string;
    blocks: readonly ContentBlock[];
}

export interface UserMessage {
    role: "user";
    id: string;
    blocks: readonly ContentBlock[];
}

export interface AgentMessage {
    role: "agent";
    id: string;
    blocks: readonly AgentBlock[];
}

export type Message = SystemMessage | UserMessage | AgentMessage;

// ---------------------------------------------------------------------------
// Agent snapshot (packages/rig/sources/agent/Agent.ts)
// ---------------------------------------------------------------------------

export type AgentStatus = "idle" | "running" | "aborted";

export interface QueuedAgentMessage {
    id: string;
    message: Message;
}

export interface AgentSnapshot {
    id: string;
    providerId: string;
    modelId: string;
    effort?: string;
    status: AgentStatus;
    instructions?: string;
    messages: readonly Message[];
    queue: readonly QueuedAgentMessage[];
    tools: readonly string[];
    lastRunId?: string;
}

// ---------------------------------------------------------------------------
// Provider-layer streaming types (packages/rig/sources/providers/types.ts)
// ---------------------------------------------------------------------------

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

/** Plain text content block on an assistant message. */
export interface TextContent {
    type: "text";
    text: string;
    textSignature?: string;
}

/** Extended thinking / reasoning content block. */
export interface ThinkingContent {
    type: "thinking";
    thinking: string;
    encrypted?: string;
    redacted?: boolean;
}

/** Tool invocation requested by the model. */
export interface ToolCall {
    type: "toolCall";
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export type AssistantContent = TextContent | ThinkingContent | ToolCall;

export interface Usage {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        total: number;
    };
}

export interface AssistantMessage {
    role: "assistant";
    content: readonly AssistantContent[];
    api: string;
    provider: string;
    model: string;
    responseModel?: string;
    responseId?: string;
    usage: Usage;
    stopReason: StopReason;
    errorMessage?: string;
    timestamp: number;
}

/** Model metadata exposed by a provider. */
export interface Model {
    id: string;
    name: string;
    thinkingLevels: readonly string[];
    defaultThinkingLevel: string;
}

/** Streaming events emitted while building an assistant message. */
export type AssistantMessageEvent =
    | { type: "start"; partial: AssistantMessage }
    | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
    | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
    | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
    | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
    | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
    | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
    | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
    | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
    | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
    | {
          type: "done";
          reason: Extract<StopReason, "stop" | "length" | "toolUse">;
          message: AssistantMessage;
      }
    | {
          type: "error";
          reason: Extract<StopReason, "aborted" | "error">;
          error: AssistantMessage;
      };

// ---------------------------------------------------------------------------
// Agent loop events (packages/rig/sources/agent/loop.ts)
// ---------------------------------------------------------------------------

export type AgentLoopEvent =
    | AssistantMessageEvent
    | {
          type: "inference_iteration_start";
          iteration: number;
      };

// ---------------------------------------------------------------------------
// Session protocol (packages/rig/sources/protocol/SessionProtocol.ts)
// ---------------------------------------------------------------------------

export type SessionStatus = "idle" | "queued" | "running" | "completed" | "aborted" | "error";

export type PermissionMode = "auto" | "workspace_write" | "read_only" | "full_access";

export interface UserInputOption {
    description: string;
    label: string;
}

export interface UserInputQuestion {
    header: string;
    id: string;
    multiSelect: boolean;
    options: readonly UserInputOption[];
    question: string;
}

export interface UserInputRequest {
    questions: readonly UserInputQuestion[];
    requestId: string;
}

export interface UserInputResponse {
    answers: Readonly<Record<string, readonly string[]>>;
}

export interface McpServerSummary {
    errorMessage?: string;
    name: string;
    status: "connected" | "disabled" | "failed";
    toolCount: number;
}

export type TaskStatus = "pending" | "in_progress" | "completed";

export interface SessionTask {
    activeForm?: string;
    blockedBy: readonly string[];
    blocks: readonly string[];
    description: string;
    id: string;
    metadata?: Readonly<Record<string, unknown>>;
    owner?: string;
    status: TaskStatus;
    subject: string;
}

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

export type GoalStatus = "active" | "blocked" | "complete" | "paused";

export interface SessionGoal {
    createdAt: number;
    objective: string;
    status: GoalStatus;
    updatedAt: number;
}

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
    goal?: SessionGoal;
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

export interface CreateSessionResponse {
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

export interface GetSessionResponse {
    session: ProtocolSession;
}

export interface ResetSessionResponse {
    session: ProtocolSession;
}

export interface ChangeModelResponse {
    session: ProtocolSession;
}

export interface ChangeEffortResponse {
    session: ProtocolSession;
}

export interface ChangePermissionModeResponse {
    session: ProtocolSession;
}

export interface GoalSessionResponse {
    session: ProtocolSession;
}

export interface AnswerUserInputResponse {
    session: ProtocolSession;
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

export interface ChangePermissionModeRequest {
    permissionMode: PermissionMode;
}

export interface SetGoalRequest {
    objective: string;
}

export interface ChangeSessionGoalStatusRequest {
    status: GoalStatus;
}

export type AnswerUserInputRequest = UserInputResponse;

export interface AbortRunResponse {
    aborted: boolean;
    eventId?: EventId;
}

// ---------------------------------------------------------------------------
// Session events (SSE payloads)
// ---------------------------------------------------------------------------

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
        modelLocked: boolean;
        runId: string;
        stopReason: StopReason;
    }
>;

export type RunErrorEvent = BaseSessionEvent<
    "run_error",
    {
        errorMessage: string;
        modelLocked: boolean;
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

export type GoalChangedEvent = BaseSessionEvent<"goal_changed", { goal: SessionGoal | null }>;

export type SubagentChangedEvent = BaseSessionEvent<
    "subagent_changed",
    {
        subagent: SubagentSummary;
    }
>;

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
    | GoalChangedEvent
    | SubagentChangedEvent;
