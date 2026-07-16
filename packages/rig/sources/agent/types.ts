/**
 * High-level types for agent transcripts and tools.
 */

import type { Static, TSchema } from "@sinclair/typebox";

import type { AgentContext } from "./context/AgentContext.js";
import type { Usage } from "../providers/types.js";
import type { ToolResultPresentation } from "./ToolResultPresentation.js";

/** Plain text content. */
export interface TextBlock {
    type: "text";
    text: string;
}

/** Image content, typically as base64 or a URL depending on provider. */
export interface ImageBlock {
    type: "image";
    mediaType: string;
    data: string;
    detail?: "high" | "original";
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
export interface ToolResultFailure {
    kind: "execution_failed" | "interrupted" | "invalid_arguments" | "tool_unavailable";
    /** Human-readable cause for failures whose display includes tool-specific context. */
    message?: string;
}

export interface ToolResultBlock {
    type: "tool_result";
    toolCallId: string;
    toolName: string;
    /** Rendered tool answer produced by the tool's `toLLM` serializer. */
    rendered: readonly ContentBlock[];
    /** Short human-facing tool summary produced by the tool's `toUI` serializer. */
    display: string;
    isError?: boolean;
    /** Stable failure state used by transcript rendering without parsing display text. */
    failure?: ToolResultFailure;
    /** Durable model-invisible data used for rich transcript rendering. */
    presentation?: ToolResultPresentation;
    /** Exact user-authored or user-selected content that Auto review may trust. */
    trustedUserEvidence?: readonly ContentBlock[];
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
    /** Provider-reported usage for inference messages. Tool-result messages omit it. */
    usage?: Usage;
    /** Durable inference attribution. Tool-result messages omit these fields. */
    providerId?: string;
    requestedModelId?: string;
    responseModel?: string;
}

export type Message = SystemMessage | UserMessage | AgentMessage;

/** A fixed lock key shared across all invocations. */
export type LockConstant = string;

/** A lock key derived from the invocation arguments. */
export type LockForArgs<TArgs> = (args: TArgs) => string;

/** Locks applied before a tool executes. Each key shares a concurrency budget. */
export type Lock<TArgs> = LockConstant | LockForArgs<TArgs>;

/** A fully typed tool with execution, LLM serialization, and concurrency control. */
export interface ToolExecutionOptions {
    /** Canonical model context immediately before this tool invocation. */
    messages?: readonly Message[];
    onProgress?: (display: string) => void;
    /** Reports a short ephemeral activity label while the tool remains active. */
    onStatus?: (status: string) => void;
    signal?: AbortSignal;
    toolCallId?: string;
}

export type AutoPermissionPredicate<TArgs> = (
    args: TArgs,
    context: AgentContext,
) => boolean | Promise<boolean>;

export type AutoPermissionActionDescriber<TArgs> = (args: TArgs, context: AgentContext) => string;

export interface DefinedTool<
    TArgsSchema extends TSchema = TSchema,
    TReturnSchema extends TSchema = TSchema,
> {
    name: string;
    label: string;
    description: string;
    arguments: TArgsSchema;
    returnType: TReturnSchema;
    execute: (
        args: Static<TArgsSchema>,
        context: AgentContext,
        options: ToolExecutionOptions,
    ) => Promise<Static<TReturnSchema>> | Static<TReturnSchema>;
    isError?: (result: Static<TReturnSchema>) => boolean;
    toLLM: (result: Static<TReturnSchema>) => readonly ContentBlock[];
    toPresentation?: (
        result: Static<TReturnSchema>,
        args: Static<TArgsSchema>,
    ) => ToolResultPresentation | undefined;
    toTrustedUserEvidence?: (
        result: Static<TReturnSchema>,
        args: Static<TArgsSchema>,
    ) => readonly ContentBlock[];
    toUI: (result: Static<TReturnSchema>, args: Static<TArgsSchema>) => string;
    /** Provider-specific Auto-mode guidance included only while this tool is active. */
    autoPermissionInstructions?: string;
    /** Describes the exact reviewed boundary in permission events and approval prompts. */
    describeAutoPermissionAction?: AutoPermissionActionDescriber<Static<TArgsSchema>>;
    requiresAutoOrFullAccess: boolean;
    shouldReviewInAutoMode: AutoPermissionPredicate<Static<TArgsSchema>>;
    shouldRunInFullAccessInAutoMode: AutoPermissionPredicate<Static<TArgsSchema>>;
    /** Locks acquired for each invocation; constants or argument-derived keys. */
    locks: readonly Lock<Static<TArgsSchema>>[];
}

export interface AnyDefinedTool {
    name: string;
    label: string;
    description: string;
    arguments: TSchema;
    returnType: TSchema;
    execute: (
        args: never,
        context: AgentContext,
        options: ToolExecutionOptions,
    ) => Promise<unknown> | unknown;
    isError?: (result: never) => boolean;
    toLLM: (result: never) => readonly ContentBlock[];
    toPresentation?: (result: never, args: never) => ToolResultPresentation | undefined;
    toTrustedUserEvidence?: (result: never, args: never) => readonly ContentBlock[];
    toUI: (result: never, args: never) => string;
    autoPermissionInstructions?: string;
    describeAutoPermissionAction?: AutoPermissionActionDescriber<never>;
    requiresAutoOrFullAccess: boolean;
    shouldReviewInAutoMode: AutoPermissionPredicate<never>;
    shouldRunInFullAccessInAutoMode: AutoPermissionPredicate<never>;
    locks: readonly Lock<never>[];
}

export type InferToolArgs<T extends AnyDefinedTool> =
    T extends DefinedTool<infer TArgsSchema extends TSchema, TSchema> ? Static<TArgsSchema> : never;

export type InferToolReturn<T extends AnyDefinedTool> =
    T extends DefinedTool<TSchema, infer TReturnSchema extends TSchema>
        ? Static<TReturnSchema>
        : never;

/** Define a tool with TypeBox-inferred argument and return types. */
export function defineTool<
    const TArgsSchema extends TSchema,
    const TReturnSchema extends TSchema,
>(tool: {
    name: string;
    label: string;
    description: string;
    arguments: TArgsSchema;
    returnType: TReturnSchema;
    execute: (
        args: Static<TArgsSchema>,
        context: AgentContext,
        options: ToolExecutionOptions,
    ) => Promise<Static<TReturnSchema>> | Static<TReturnSchema>;
    isError?: (result: Static<TReturnSchema>) => boolean;
    toLLM: (result: Static<TReturnSchema>) => readonly ContentBlock[];
    toPresentation?: (
        result: Static<TReturnSchema>,
        args: Static<TArgsSchema>,
    ) => ToolResultPresentation | undefined;
    toTrustedUserEvidence?: (
        result: Static<TReturnSchema>,
        args: Static<TArgsSchema>,
    ) => readonly ContentBlock[];
    toUI: (result: Static<TReturnSchema>, args: Static<TArgsSchema>) => string;
    autoPermissionInstructions?: string;
    describeAutoPermissionAction?: AutoPermissionActionDescriber<Static<TArgsSchema>>;
    requiresAutoOrFullAccess?: boolean;
    shouldReviewInAutoMode: AutoPermissionPredicate<Static<TArgsSchema>>;
    shouldRunInFullAccessInAutoMode?: AutoPermissionPredicate<Static<TArgsSchema>>;
    locks: readonly Lock<Static<TArgsSchema>>[];
}): DefinedTool<TArgsSchema, TReturnSchema> {
    return {
        ...tool,
        requiresAutoOrFullAccess: tool.requiresAutoOrFullAccess ?? false,
        shouldRunInFullAccessInAutoMode: tool.shouldRunInFullAccessInAutoMode ?? (() => false),
    };
}
