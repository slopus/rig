/**
 * Provider-layer types for model listing and streaming inference.
 *
 * Content blocks and message shapes follow pi conventions and sit below the
 * higher-level agent transcript types in `sources/agent/types.ts`.
 */

import type { TSchema } from "@sinclair/typebox";
import type { ProviderQuota } from "./providerQuota.js";

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";
export type ProviderErrorCode = "incomplete_response" | "invalid_image_request";
export type ProviderImageProfile = "claude" | "codex";
export type ProviderToolProfile = "claude" | "codex" | "grok" | "kimi" | "pi";
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
    arguments: Record<string, unknown>;
}

export type UserContent = TextContent | ImageContent;
export type AssistantContent = TextContent | ThinkingContent | ToolCall;
export type ToolResultContent = TextContent | ImageContent;

export interface UserMessage {
    role: "user";
    content: string | readonly UserContent[];
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
    endTurn?: boolean;
    usage: Usage;
    stopReason: StopReason;
    errorCode?: ProviderErrorCode;
    errorMessage?: string;
    timestamp: number;
}

export interface ToolResultMessage {
    role: "toolResult";
    toolCallId: string;
    toolName: string;
    content: readonly ToolResultContent[];
    isError: boolean;
    timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export interface Tool<TParameters extends TSchema = TSchema> {
    name: string;
    description: string;
    parameters: TParameters;
}

export interface Context {
    systemPrompt?: string;
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
    /** Maximum input context used for automatic conversation compaction. */
    contextWindow?: number;
}

export interface StreamOptions<TThinkingLevel extends string = string> {
    signal?: AbortSignal;
    sessionId?: string;
    serviceTier?: ServiceTier;
    thinking?: TThinkingLevel;
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
    readonly models: readonly Model[];
    readonly serviceTiers?: readonly ServiceTier[];
    imageProfile(model: Model): ProviderImageProfile;
    toolProfile(model: Model): ProviderToolProfile;
    quota?(options?: { fresh?: boolean }): Promise<ProviderQuota>;
    generateImage?(prompt: string, options?: { signal?: AbortSignal }): Promise<GeneratedImage>;
    stream<TThinkingLevel extends string>(
        model: Model<TThinkingLevel>,
        context: Context,
        options?: StreamOptions<TThinkingLevel>,
    ): InferenceStream;
}

export interface GeneratedImage {
    data: string;
    mediaType: "image/png";
    revisedPrompt?: string;
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
}): Model<TThinkingLevel> {
    return model;
}

/** Statically typed helper for constructing a provider definition. */
export function defineProvider(provider: {
    id: string;
    models: readonly Model[];
    serviceTiers?: readonly ServiceTier[];
    imageProfile?: (model: Model) => ProviderImageProfile;
    toolProfile?: (model: Model) => ProviderToolProfile;
    quota?: (options?: { fresh?: boolean }) => Promise<ProviderQuota>;
    generateImage?: (prompt: string, options?: { signal?: AbortSignal }) => Promise<GeneratedImage>;
    stream<TThinkingLevel extends string>(
        model: Model<TThinkingLevel>,
        context: Context,
        options?: StreamOptions<TThinkingLevel>,
    ): InferenceStream;
}): Provider {
    return { imageProfile: () => "codex", toolProfile: () => "codex", ...provider };
}
