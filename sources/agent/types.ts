/**
 * High-level types for agent transcripts and tools.
 */

import type { Static, TSchema } from "@sinclair/typebox";

import type { AgentContext } from "./context/AgentContext.js";

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
export type AgentBlock =
  | ContentBlock
  | ThinkingBlock
  | ToolCallBlock
  | ToolResultBlock;

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

/** A fixed lock key shared across all invocations. */
export type LockConstant = string;

/** A lock key derived from the invocation arguments. */
export type LockForArgs<TArgs> = (args: TArgs) => string;

/** Locks applied before a tool executes. Each key shares a concurrency budget. */
export type Lock<TArgs> = LockConstant | LockForArgs<TArgs>;

/** A fully typed tool with execution, LLM serialization, and concurrency control. */
export interface ToolExecutionOptions {
  signal?: AbortSignal;
}

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
  toLLM: (result: Static<TReturnSchema>) => readonly ContentBlock[];
  toUI: (
    result: Static<TReturnSchema>,
    args: Static<TArgsSchema>,
  ) => string;
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
  toLLM: (result: never) => readonly ContentBlock[];
  toUI: (result: never, args: never) => string;
  locks: readonly Lock<never>[];
}

export type InferToolArgs<T extends AnyDefinedTool> =
  T extends DefinedTool<infer TArgsSchema extends TSchema, TSchema>
    ? Static<TArgsSchema>
    : never;

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
  toLLM: (result: Static<TReturnSchema>) => readonly ContentBlock[];
  toUI: (
    result: Static<TReturnSchema>,
    args: Static<TArgsSchema>,
  ) => string;
  locks: readonly Lock<Static<TArgsSchema>>[];
}): DefinedTool<TArgsSchema, TReturnSchema> {
  return tool;
}
