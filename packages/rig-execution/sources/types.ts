/**
 * Provider-layer types for model listing and streaming inference.
 *
 * Content blocks and message shapes follow pi conventions and sit below the
 * higher-level agent transcript types in `sources/agent/types.ts`.
 */

import type { TSchema } from "@sinclair/typebox";
import type { ProviderQuota } from "@slopus/rig-providers";

export type ProfileProviderType = "bedrock" | "claude" | "codex" | "grok";
export interface ProfilePromptContext {
    claudeConfigDirectory?: string;
    claudeGitStatus?: string;
    cwd?: string;
    effort?: string;
    home?: string;
    isGitRepository?: boolean;
    modelId: string;
    osVersion?: string;
    platform?: NodeJS.Platform;
    projectRoot?: string;
    providerId: string;
    shell?: string;
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";
export type ProviderErrorCode = "incomplete_response" | "invalid_image_request";
/** `resetAt` is a Unix timestamp in milliseconds when present. */
export type ProviderError =
    | { type: "out_of_tokens"; resetAt?: number }
    | { type: "rate_limit"; resetAt?: number }
    | { type: "server_overloaded" }
    | { type: "internal_server_error"; requestId?: string }
    | { type: "unclassified" };
export type ProviderImageProfile = "claude" | "codex";
export type ProviderToolProfile = "claude" | "codex" | "grok";
export type ServiceTier = "fast";

/** Plain text content block. */
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

/** Image content block, typically base64-encoded. */
export interface ImageContent {
    type: "image";
    data: string;
    mimeType: string;
    detail?: "high" | "original";
}

/** Tool invocation requested by the model. */
export interface ToolCall {
    type: "toolCall";
    id: string;
    name: string;
    namespace?: string;
    arguments: Record<string, unknown>;
    kind?: "custom" | "function" | "tool_search";
    /** Opaque provider metadata required to replay this call faithfully. */
    vendor?: unknown;
}

export type UserContent = TextContent | ImageContent;
export type AssistantContent = TextContent | ThinkingContent | ToolCall;
export type ToolResultContent = TextContent | ImageContent;

export interface UserMessage {
    role: "user";
    content: string | readonly UserContent[];
    encryptedAgentMessage?: {
        author: string;
        recipient: string;
        header: string;
        encryptedContent: string;
    };
    timestamp: number;
}

export interface AssistantMessage {
    role: "assistant";
    content: readonly AssistantContent[];
    api: string;
    provider: string;
    model: string;
    responseModel?: string;
    responseId?: string;
    /** Ordered opaque provider output items required for native continuation. */
    responseItems?: readonly string[];
    endTurn?: boolean;
    usage: Usage;
    stopReason: StopReason;
    errorCode?: ProviderErrorCode;
    errorMessage?: string;
    providerError?: ProviderError;
    timestamp: number;
}

export interface ToolResultMessage {
    role: "toolResult";
    toolCallId: string;
    toolName: string;
    content: readonly ToolResultContent[];
    isError: boolean;
    /** Opaque provider metadata copied from the originating tool call. */
    vendor?: unknown;
    timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export interface FunctionTool<TParameters extends TSchema = TSchema> {
    kind?: "function";
    name: string;
    description: string;
    parameters: TParameters;
    deferLoading?: boolean;
    namespace?: string;
    namespaceDescription?: string;
}

export interface CustomTool {
    kind: "custom";
    name: string;
    description: string;
    namespace?: string;
    namespaceDescription?: string;
    format?: {
        type: "grammar";
        syntax: "lark" | "regex";
        definition: string;
    };
}

export interface ToolSearchTool {
    kind: "tool_search";
    name: "tool_search";
    description: string;
    execution: "client";
    parameters: TSchema;
}

export type Tool<TParameters extends TSchema = TSchema> =
    | FunctionTool<TParameters>
    | CustomTool
    | ToolSearchTool;

export interface PreambleMessage {
    role: "developer" | "user";
    content: string | readonly string[];
}

export interface Context {
    /** Additional runtime instructions assembled by the external agent host. */
    systemPrompt?: string;
    /** Exact replacement for the Executor-owned model base prompt. */
    systemPromptOverride?: string;
    preamble?: readonly PreambleMessage[];
    messages: readonly Message[];
    tools?: readonly Tool[];
}

export interface Usage {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    /** Reported reasoning tokens, when the provider exposes an exact breakdown. */
    reasoning?: number;
    cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        total: number;
    };
}

/** Model metadata exposed by a provider. */
export interface Model<TThinkingLevel extends string = string> {
    id: string;
    name: string;
    thinkingLevels: readonly TThinkingLevel[];
    defaultThinkingLevel: TThinkingLevel;
    /** Maximum input context accepted by the model. */
    contextWindow?: number;
    /** Smaller effective window used to decide when automatic compaction begins. */
    autoCompactWindow?: number;
}

export interface StreamOptions<TThinkingLevel extends string = string> {
    intent?: "compaction";
    signal?: AbortSignal;
    sessionId?: string;
    serviceTier?: ServiceTier;
    /** Local calendar date when the inference session began, formatted as YYYY-MM-DD. */
    startDate?: string;
    thinking?: TThinkingLevel;
}

export interface ProviderCompactionOptions<
    TThinkingLevel extends string = string,
> extends StreamOptions<TThinkingLevel> {
    prompt: string;
    timestamp: number;
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

/** Async stream of assistant message events with a final result promise. */
export interface InferenceStream extends AsyncIterable<AssistantMessageEvent> {
    result(): Promise<AssistantMessage>;
}

/** A provider exposes models and streaming inference. */
export interface Provider {
    readonly id: string;
    /** Stable provider kind; unlike id, this does not change for named accounts. */
    readonly type: ProfileProviderType | undefined;
    readonly models: readonly Model[];
    readonly serviceTiers: readonly ServiceTier[] | undefined;
    readonly extendProfilePromptContext:
        | ((context: ProfilePromptContext) => ProfilePromptContext | Promise<ProfilePromptContext>)
        | undefined;
    close?(): Promise<void> | void;
    quota: ((options?: { fresh?: boolean }) => Promise<ProviderQuota>) | undefined;
    stream<TThinkingLevel extends string>(
        model: Model<TThinkingLevel>,
        context: Context,
        options?: StreamOptions<TThinkingLevel>,
    ): InferenceStream;
}

export type InferProviderModels<T extends Provider> = T["models"];

export type InferModel<TModels extends readonly Model[]> = TModels[number];

export type InferModelThinkingLevel<T extends Model> =
    T extends Model<infer TThinkingLevel> ? TThinkingLevel : never;

/** Statically typed helper for constructing a model definition. */
export function defineModel<const TThinkingLevel extends string>(model: {
    id: string;
    name: string;
    thinkingLevels: readonly TThinkingLevel[];
    defaultThinkingLevel: TThinkingLevel;
    contextWindow?: number;
    autoCompactWindow?: number;
}): Model<TThinkingLevel> {
    return model;
}

/** Statically typed helper for constructing a provider definition. */
export function defineProvider(provider: {
    id: string;
    type?: ProfileProviderType;
    models: readonly Model[];
    serviceTiers?: readonly ServiceTier[];
    extendProfilePromptContext?: (
        context: ProfilePromptContext,
    ) => ProfilePromptContext | Promise<ProfilePromptContext>;
    close?(): Promise<void> | void;
    quota?: (options?: { fresh?: boolean }) => Promise<ProviderQuota>;
    stream<TThinkingLevel extends string>(
        model: Model<TThinkingLevel>,
        context: Context,
        options?: StreamOptions<TThinkingLevel>,
    ): InferenceStream;
}): Provider {
    return {
        extendProfilePromptContext: undefined,
        quota: undefined,
        serviceTiers: undefined,
        type: undefined,
        ...provider,
    };
}
