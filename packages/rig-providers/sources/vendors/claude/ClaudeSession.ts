import { randomUUID } from "node:crypto";

import {
    query as defaultClaudeSdkQuery,
    type SDKAssistantMessageError,
    type SDKRateLimitInfo,
    type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";

import { BaseSession } from "@/core/BaseSession.js";
import { EMPTY_SESSION_CACHE_USAGE, type SessionCacheUsage } from "@/core/SessionCacheUsage.js";
import type { SessionCompaction, SessionCompactionOptions } from "@/core/SessionCompaction.js";
import type {
    SessionContext,
    SessionToolCall,
    SessionToolResultMessage,
} from "@/core/SessionContext.js";
import type { SessionEvent, SessionStream } from "@/core/SessionEvent.js";
import type { SessionReasoningEffort, SessionRunRequest } from "@/core/SessionRunRequest.js";
import type { SessionModelConfiguration } from "@/core/SessionModelConfiguration.js";
import type { SessionSkill } from "@/core/SessionSkill.js";
import type { SessionTool } from "@/core/SessionTool.js";
import { withInitialSessionMessages } from "@/core/withInitialSessionMessages.js";
import { resolveClaudeModelId } from "@/vendors/claude/impl/resolveClaudeModelId.js";
import type { ClaudeCredential } from "@/vendors/VendorCredential.js";
import { ClaudePromptQueue } from "@/vendors/claude/impl/ClaudePromptQueue.js";
import { ClaudeToolBridge } from "@/vendors/claude/impl/ClaudeToolBridge.js";
import { claudeResultErrorMessage } from "@/vendors/claude/impl/claudeResultErrorMessage.js";
import { classifyClaudeError } from "@/vendors/claude/impl/classifyClaudeError.js";
import {
    createClaudeLivePromptMessage,
    createClaudeSessionReplay,
    type ClaudeSessionReplay,
} from "@/vendors/claude/impl/createClaudeSessionReplay.js";
import { resolveClaudeTools } from "@/vendors/claude/impl/resolveClaudeTools.js";
import { toClaudeSdkOptions } from "@/vendors/claude/impl/toClaudeSdkOptions.js";
import { toClaudeRetryEvent } from "@/vendors/claude/impl/toClaudeRetryEvent.js";

export type ClaudeSdkQuery = typeof defaultClaudeSdkQuery;

export interface ClaudeSessionOptions {
    context: SessionContext;
    credential: ClaudeCredential;
    cwd: string;
    env?: NodeJS.ProcessEnv;
    model?: string;
    modelConfigurations?: Readonly<Record<string, SessionModelConfiguration>>;
    pathToClaudeCodeExecutable?: string;
    query?: ClaudeSdkQuery;
    skills?: readonly SessionSkill[];
    tools?: readonly SessionTool[];
}

export class ClaudeSession extends BaseSession {
    readonly credential: ClaudeCredential;
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly model: string | undefined;
    readonly pathToClaudeCodeExecutable: string | undefined;
    readonly skills: readonly SessionSkill[] | undefined;
    readonly tools: readonly SessionTool[] | undefined;

    private activeEffort: SessionReasoningEffort | undefined;
    private activeModel: string | undefined;
    private readonly initialMessages: SessionContext["messages"];
    private readonly modelConfigurations:
        | Readonly<Record<string, SessionModelConfiguration>>
        | undefined;
    private context: SessionContext;
    private readonly sdkSessionId = randomUUID();
    private readonly query: ClaudeSdkQuery;
    private activeQuery: ReturnType<ClaudeSdkQuery> | undefined;
    private activeQueryKey: string | undefined;
    private activePromptQueue: ClaudePromptQueue | undefined;
    private activeReplay: ClaudeSessionReplay | undefined;
    private activeToolBridge: ClaudeToolBridge | undefined;
    private lastQueryToolCalls: SessionToolCall[] = [];

    constructor(id: string, options: ClaudeSessionOptions) {
        super(id);
        this.credential = options.credential;
        this.cwd = options.cwd;
        this.env = options.env ?? process.env;
        this.model = options.model;
        this.activeModel = options.model;
        this.pathToClaudeCodeExecutable = options.pathToClaudeCodeExecutable;
        this.skills = options.skills;
        this.tools = options.tools;
        this.modelConfigurations = options.modelConfigurations;
        this.query = options.query ?? defaultClaudeSdkQuery;
        this.context = {
            instructions: options.context.instructions,
            messages: [...options.context.messages],
        };
        this.initialMessages = [...options.context.messages];
    }

    run(request: SessionRunRequest): SessionStream {
        if (request.abort?.aborted) return emptyStream();
        return this.streamRun(request);
    }

    async compact(options: SessionCompactionOptions = {}): Promise<SessionCompaction> {
        const original = this.context;
        const { instructions, signal } = options;
        if (signal?.aborted) return { status: "cancelled", context: original };
        const model = this.activeModel ?? this.model;
        if (model === undefined) throw new Error("A model is required for Claude compaction.");
        const compactContext: SessionContext = {
            instructions: original.instructions,
            messages: [
                ...original.messages,
                {
                    role: "user",
                    content:
                        instructions === undefined || instructions.trim().length === 0
                            ? "/compact"
                            : `/compact ${instructions}`,
                },
            ],
        };
        let summary = "";
        let usage: SessionCacheUsage | undefined;
        let done: Extract<SessionEvent, { type: "done" }> | undefined;
        for await (const event of this.streamQuery({
            context: compactContext,
            model,
            ...(this.activeEffort === undefined ? {} : { effort: this.activeEffort }),
            ...(signal === undefined ? {} : { abort: signal }),
            compaction: true,
        })) {
            if (event.type === "text_delta") summary += event.delta;
            if (event.type === "token_usage") usage = event.usage;
            if (event.type === "done") done = event;
        }
        if (signal?.aborted) return { status: "cancelled", context: original };
        if (done?.state === "tool_call") {
            return {
                status: "failed",
                kind: "tool_call",
                message: "Claude attempted to call a tool while compacting.",
                context: original,
            };
        }
        if (done?.state === "error") {
            return {
                status: "failed",
                kind: "inference_error",
                message: done.message,
                context: original,
            };
        }
        if (summary.trim().length === 0) {
            return {
                status: "failed",
                kind: "invalid_summary",
                message: "Claude returned an empty compaction summary.",
                context: original,
            };
        }
        const preservedMessages = [...this.initialMessages];
        this.context = {
            instructions: original.instructions,
            messages: [...preservedMessages, { role: "user", content: summary }],
        };
        return {
            status: "completed",
            summary,
            preservedMessages,
            ...(usage === undefined ? {} : { usage }),
            context: this.context,
        };
    }

    destroy(): void {
        this.closeActiveQuery();
    }

    private async *streamRun(request: SessionRunRequest): AsyncGenerator<SessionEvent> {
        const requestedModel = request.model ?? this.activeModel ?? this.model;
        const model =
            requestedModel === undefined ? undefined : resolveClaudeModelId(requestedModel);
        if (model === undefined) throw new Error("A model is required for Claude inference.");
        this.activeModel = model;
        const effort = request.effort ?? this.activeEffort;
        this.activeEffort = effort;
        this.context = {
            instructions: this.context.instructions,
            messages: withInitialSessionMessages(this.initialMessages, [
                ...request.context.messages,
            ]),
        };
        let assistantText = "";
        for await (const event of this.streamQuery({
            context: this.context,
            model,
            ...(effort === undefined ? {} : { effort }),
            ...(request.abort === undefined ? {} : { abort: request.abort }),
        })) {
            if (event.type === "text_delta") assistantText += event.delta;
            if (event.type === "done" && event.state !== "error") {
                this.context = {
                    instructions: this.context.instructions,
                    messages: [
                        ...this.context.messages,
                        {
                            role: "assistant",
                            content: assistantText,
                            ...(this.lastQueryToolCalls.length === 0
                                ? {}
                                : { toolCalls: this.lastQueryToolCalls }),
                        },
                    ],
                };
            }
            yield event;
        }
    }

    private async *streamQuery(options: {
        abort?: AbortSignal;
        compaction?: boolean;
        context: SessionContext;
        effort?: SessionReasoningEffort;
        model: string;
    }): AsyncGenerator<SessionEvent> {
        yield { type: "block_start" };
        const modelConfiguration = this.modelConfigurations?.[options.model];
        const skills = modelConfiguration?.skills ?? this.skills ?? [];
        const tools = modelConfiguration?.tools ?? this.tools ?? resolveClaudeTools(options.model);
        const systemPrompt = "";
        const configuredContext =
            modelConfiguration === undefined
                ? options.context
                : {
                      instructions: modelConfiguration.context.instructions,
                      messages: [
                          ...modelConfiguration.context.messages.filter(
                              (message) => message.role === "system",
                          ),
                          ...options.context.messages,
                      ],
                  };
        const queryKey = JSON.stringify({
            compaction: options.compaction === true,
            effort: options.effort,
            model: options.model,
            systemPrompt,
            tools,
        });
        const continuingQuery =
            this.activeQuery !== undefined &&
            this.activePromptQueue !== undefined &&
            this.activeQueryKey === queryKey;
        if (!continuingQuery) this.closeActiveQuery();
        const { abort: _abort, ...sdkRequestOptions } = options;
        const replay = createClaudeSessionReplay({
            context: configuredContext,
            cwd: this.cwd,
            model: options.model,
            sessionId: this.sdkSessionId,
        });
        const replayableMessageCount = configuredContext.messages.filter(
            (message) => message.role !== "system",
        ).length;
        if (!continuingQuery && replayableMessageCount > 1) {
            // Applied below after the live tool bridge is installed.
        }
        let stream = this.activeQuery;
        const abort = () => {
            if (typeof stream?.interrupt === "function") void stream.interrupt();
        };
        options.abort?.addEventListener("abort", abort, { once: true });
        const activeTools = new Map<number, SessionToolCall>();
        this.lastQueryToolCalls = [];
        let sawToolCall = false;
        let sawText = false;
        let nativeCompactionCompleted = false;
        let nativeCompactionError: string | undefined;
        let result: SDKResultMessage | undefined;
        let assistantError: SDKAssistantMessageError | undefined;
        let rateLimitInfo: SDKRateLimitInfo | undefined;
        let requestId: string | undefined;
        let usage = { ...EMPTY_SESSION_CACHE_USAGE };
        try {
            if (!continuingQuery) {
                const promptQueue = new ClaudePromptQueue();
                const toolBridge = new ClaudeToolBridge();
                const sdkOptions = toClaudeSdkOptions({
                    ...sdkRequestOptions,
                    context: configuredContext,
                    credential: this.credential,
                    cwd: this.cwd,
                    env: this.env,
                    ...(this.pathToClaudeCodeExecutable === undefined
                        ? {}
                        : { pathToClaudeCodeExecutable: this.pathToClaudeCodeExecutable }),
                    sessionId: this.sdkSessionId,
                    skills,
                    systemPrompt,
                    tools,
                    callTool: (name) => toolBridge.execute(name),
                });
                if (replayableMessageCount > 1) {
                    delete sdkOptions.sessionId;
                    Object.assign(sdkOptions, replay.options);
                }
                promptQueue.enqueue(replay.message);
                if (options.compaction) promptQueue.close();
                this.activePromptQueue = promptQueue;
                this.activeReplay = replay;
                this.activeToolBridge = toolBridge;
                this.activeQueryKey = queryKey;
                this.activeQuery = this.query({ prompt: promptQueue, options: sdkOptions });
                stream = this.activeQuery;
            } else {
                const resolvedToolResult = trailingToolResults(configuredContext.messages).some(
                    (message) => this.activeToolBridge?.resolve(message) === true,
                );
                if (!resolvedToolResult) {
                    this.activePromptQueue?.enqueue(
                        createClaudeLivePromptMessage(configuredContext.messages),
                    );
                }
            }
            if (stream === undefined) throw new Error("Claude SDK query was not created.");
            for (;;) {
                const next = await stream.next();
                if (next.done) {
                    if (options.compaction && nativeCompactionCompleted) break;
                    this.closeActiveQuery();
                    throw new Error("Claude SDK connection closed before returning a result.");
                }
                const message = next.value;
                if (options.abort?.aborted) {
                    yield { type: "block_reset" };
                    return;
                }
                if (message.type === "system" && message.subtype === "api_retry") {
                    yield toClaudeRetryEvent(message);
                    continue;
                }
                if (message.type === "rate_limit_event") {
                    rateLimitInfo = message.rate_limit_info;
                    continue;
                }
                if (message.type === "assistant" && message.error !== undefined) {
                    assistantError = message.error;
                    requestId = message.request_id;
                    continue;
                }
                if (
                    options.compaction &&
                    message.type === "system" &&
                    message.subtype === "compact_boundary"
                ) {
                    nativeCompactionCompleted = true;
                    continue;
                }
                if (
                    options.compaction &&
                    message.type === "system" &&
                    message.subtype === "status" &&
                    message.compact_result === "failed"
                ) {
                    nativeCompactionError =
                        message.compact_error ?? "Claude native compaction failed.";
                    continue;
                }
                if (message.type === "stream_event") {
                    const event = message.event;
                    if (
                        event.type === "content_block_start" &&
                        event.content_block.type === "tool_use"
                    ) {
                        sawToolCall = true;
                        activeTools.set(event.index, {
                            callId: event.content_block.id,
                            name: event.content_block.name,
                            arguments: "",
                            vendor: { type: "claude_tool_use" },
                        });
                        this.activeToolBridge?.register(
                            event.content_block.id,
                            event.content_block.name,
                        );
                        yield {
                            type: "tool_call_start",
                            callId: event.content_block.id,
                            name: event.content_block.name,
                            vendor: { type: "claude_tool_use" },
                        };
                        continue;
                    }
                    if (event.type === "content_block_delta") {
                        if (event.delta.type === "text_delta") {
                            sawText = true;
                            yield { type: "text_delta", delta: event.delta.text };
                        } else if (event.delta.type === "thinking_delta") {
                            yield { type: "reasoning_delta", delta: event.delta.thinking };
                        } else if (event.delta.type === "signature_delta") {
                            yield { type: "encrypted_reasoning", content: event.delta.signature };
                        } else if (event.delta.type === "input_json_delta") {
                            const block = activeTools.get(event.index);
                            if (block !== undefined) {
                                activeTools.set(event.index, {
                                    ...block,
                                    arguments: block.arguments + event.delta.partial_json,
                                });
                                yield {
                                    type: "tool_call_delta",
                                    callId: block.callId,
                                    delta: event.delta.partial_json,
                                };
                            }
                        }
                    }
                    if (event.type === "message_delta") {
                        usage = toUsage(event.usage);
                    }
                    if (event.type === "content_block_stop") {
                        const block = activeTools.get(event.index);
                        if (block !== undefined) {
                            yield {
                                type: "tool_call_end",
                                callId: block.callId,
                                arguments: block.arguments,
                            };
                        }
                    }
                    if (event.type === "message_stop" && sawToolCall) {
                        this.lastQueryToolCalls = [...activeTools.values()];
                        yield { type: "token_usage", usage };
                        yield { type: "block_end" };
                        yield { type: "done", state: "tool_call" };
                        return;
                    }
                    continue;
                }
                if (message.type === "result") {
                    result = message;
                    break;
                }
            }
            if (nativeCompactionError !== undefined) {
                throw new Error(nativeCompactionError);
            }
            if (options.compaction && nativeCompactionCompleted) {
                const summary = findNativeCompactionSummary(this.activeReplay?.entries() ?? []);
                if (summary === undefined) {
                    throw new Error(
                        "Claude SDK compacted the session without persisting a summary.",
                    );
                }
                this.closeActiveQuery();
                yield { type: "text_delta", delta: summary };
                yield { type: "token_usage", usage };
                yield { type: "done", state: "normal" };
                return;
            }
            if (result === undefined && !sawToolCall) {
                throw new Error("Claude SDK finished without returning a result.");
            }
            if (result !== undefined) {
                usage = toUsage(result.usage);
                if (!sawText && result.subtype === "success" && result.result.length > 0) {
                    yield { type: "text_delta", delta: result.result };
                }
                if (result.subtype !== "success" || result.is_error) {
                    const message =
                        result.subtype === "success"
                            ? result.result.trim() || "Claude returned an unsuccessful result."
                            : claudeResultErrorMessage(result);
                    const providerError = classifyClaudeError({
                        ...(assistantError === undefined ? {} : { assistantError }),
                        message,
                        ...(rateLimitInfo === undefined ? {} : { rateLimitInfo }),
                        ...(requestId === undefined ? {} : { requestId }),
                    });
                    this.closeActiveQuery();
                    yield { type: "block_reset" };
                    yield {
                        type: "done",
                        state: "error",
                        kind:
                            providerError.type === "out_of_tokens"
                                ? "billing_error"
                                : providerError.type === "server_overloaded" ||
                                    providerError.type === "internal_server_error"
                                  ? "internal_error"
                                  : "unknown",
                        message,
                        providerError,
                    };
                    return;
                }
            }
            this.lastQueryToolCalls = [...activeTools.values()];
            yield { type: "token_usage", usage };
            yield { type: "block_end" };
            yield { type: "done", state: sawToolCall ? "tool_call" : "normal" };
        } catch (error) {
            this.closeActiveQuery();
            yield { type: "block_reset" };
            if (options.abort?.aborted) return;
            const rawMessage = error instanceof Error ? error.message : String(error);
            const message = rawMessage.trim() || "Claude inference failed with an unknown error.";
            const providerError = classifyClaudeError({
                ...(assistantError === undefined ? {} : { assistantError }),
                message,
                ...(rateLimitInfo === undefined ? {} : { rateLimitInfo }),
                ...(requestId === undefined ? {} : { requestId }),
            });
            yield {
                type: "done",
                state: "error",
                kind:
                    providerError.type === "out_of_tokens"
                        ? "billing_error"
                        : providerError.type === "server_overloaded" ||
                            providerError.type === "internal_server_error"
                          ? "internal_error"
                          : "unknown",
                message,
                providerError,
            };
        } finally {
            options.abort?.removeEventListener("abort", abort);
        }
    }

    private closeActiveQuery(): void {
        this.activeToolBridge?.close();
        this.activeToolBridge = undefined;
        this.activePromptQueue?.close();
        this.activePromptQueue = undefined;
        this.activeQuery?.close();
        this.activeQuery = undefined;
        this.activeQueryKey = undefined;
        this.activeReplay = undefined;
    }
}

function trailingToolResults(
    messages: readonly SessionContext["messages"][number][],
): SessionToolResultMessage[] {
    const results: SessionToolResultMessage[] = [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role !== "tool") break;
        results.unshift(message);
    }
    return results;
}

function findNativeCompactionSummary(
    entries: readonly { [key: string]: unknown }[],
): string | undefined {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry?.isCompactSummary !== true) continue;
        const message = entry.message as { content?: unknown } | undefined;
        if (typeof message?.content === "string" && message.content.trim().length > 0) {
            return message.content;
        }
    }
    return undefined;
}

function toUsage(usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
}): SessionCacheUsage {
    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    return {
        input,
        output,
        cacheRead,
        cacheWrite,
        totalTokens: input + output + cacheRead + cacheWrite,
    };
}

function emptyStream(): SessionStream {
    async function* stream(): AsyncGenerator<SessionEvent> {}
    return stream();
}
