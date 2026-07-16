import { createId } from "@paralleldrive/cuid2";
import { Value } from "@sinclair/typebox/value";

import { assistantMessageToAgentMessage } from "./assistantMessageToAgentMessage.js";
import { createAmbiguousToolCallRejection } from "./createAmbiguousToolCallRejection.js";
import type { AgentContext } from "./context/AgentContext.js";
import type { BashSessionActivity } from "./context/BashContext.js";
import { delayBeforeInferenceRetry } from "./delayBeforeInferenceRetry.js";
import { hasResponseContentBegun } from "./hasResponseContentBegun.js";
import { INFERENCE_MAX_RETRIES } from "./inferenceRetryPolicy.js";
import { isContextWindowExceededError } from "./isContextWindowExceededError.js";
import { isInvalidImageRequestError } from "./isInvalidImageRequestError.js";
import { isRetryableInferenceError } from "./isRetryableInferenceError.js";
import { prepareProviderMessageImages } from "./prepareProviderMessageImages.js";
import { replaceLastTurnToolResultImages } from "./replaceLastTurnToolResultImages.js";
import { createSystemPrompt } from "./createSystemPrompt.js";
import type {
    AgentBlock,
    AgentMessage,
    AnyDefinedTool,
    ContentBlock,
    Message,
    ToolResultBlock,
    UserMessage,
} from "./types.js";
import type {
    AssistantContent as ProviderAssistantContent,
    AssistantMessage as ProviderAssistantMessage,
    AssistantMessageEvent,
    Context as ProviderContext,
    Message as ProviderMessage,
    Model,
    Provider,
    ServiceTier,
    StopReason,
    StreamOptions,
    Tool as ProviderTool,
    ToolCall as ProviderToolCall,
    ToolResultContent as ProviderToolResultContent,
    ToolResultMessage as ProviderToolResultMessage,
    Usage,
    UserContent as ProviderUserContent,
} from "../providers/types.js";
import {
    requestAutoPermissionApproval,
    reviewAutoPermission,
    summarizePermissionAction,
} from "../permissions/index.js";
import type { DebugLog } from "../debug/index.js";

export interface RunAgentLoopOptions {
    debug?: DebugLog;
    provider: Provider;
    modelId: string;
    effort?: string;
    serviceTier?: ServiceTier;
    tools: readonly AnyDefinedTool[];
    instructions?: string;
    messages: readonly Message[];
    /** Model-facing history, when the visible transcript has been compacted. */
    contextMessages?: readonly Message[];
    compactContext?: (
        messages: readonly Message[],
        options: { force: boolean; reportedTokens?: number },
    ) => Promise<
        | {
              compacted: boolean;
              contextMessages: readonly Message[];
          }
        | undefined
    >;
    signal?: AbortSignal;
    sessionId?: string;
    idFactory?: () => string;
    now?: () => number;
    onEvent?: (event: AgentLoopEvent) => void | Promise<void>;
    onMessage?: (message: Message) => void | Promise<void>;
    takeSteering?: () => readonly UserMessage[];
    context: AgentContext;
}

export type AgentLoopEvent =
    | AssistantMessageEvent
    | {
          type: "context_compacted";
          compactedMessageCount: number;
          estimatedTokensAfter: number;
          estimatedTokensBefore: number;
          reason: "context_window" | "threshold";
      }
    | {
          type: "inference_iteration_start";
          iteration: number;
      }
    | {
          type: "steering_applied";
          messageIds: readonly string[];
      }
    | {
          type: "inference_retry";
          attempt: number;
          maxAttempts: number;
          reason: "incomplete_response";
      }
    | {
          type: "tool_execution_start";
          toolCall: ProviderToolCall;
      }
    | {
          type: "tool_execution_end";
          result: Pick<
              ToolResultBlock,
              "display" | "isError" | "presentation" | "toolCallId" | "toolName" | "type"
          >;
      }
    | {
          type: "tool_execution_progress";
          display: string;
          toolCallId: string;
      }
    | {
          type: "tool_execution_status";
          status: string;
          toolCallId: string;
      }
    | {
          type: "tool_batch_rejected";
          toolCallIds: readonly string[];
      }
    | {
          type: "permission_review";
          action: string;
          decision: "allow" | "ask";
          reason: string;
          risk: "low" | "medium" | "high";
          toolCallId: string;
          userAuthorization: "low" | "medium" | "high";
      }
    | {
          type: "background_processes_changed";
          processes?: readonly BashSessionActivity[];
          running: number;
      }
    | {
          type: "background_processes_stopped";
          count: number;
      };

export interface AgentLoopResult {
    messages: readonly Message[];
    contextMessages: readonly Message[];
    stopReason: StopReason;
}

export async function runAgentLoop(options: RunAgentLoopOptions): Promise<AgentLoopResult> {
    const model = findModel(options.provider, options.modelId);
    const idFactory = options.idFactory ?? createId;
    const now = options.now ?? Date.now;
    const transcript: Message[] = [...options.messages];
    const contextTranscript: Message[] = [...(options.contextMessages ?? options.messages)];
    const providerMessages = toProviderMessages(contextTranscript, {
        model,
        now,
        providerId: options.provider.id,
    });
    const systemPrompt = await createSystemPrompt({
        provider: options.provider,
        model,
        ...(options.instructions !== undefined ? { instructions: options.instructions } : {}),
        messages: contextTranscript,
        context: options.context,
        tools: options.tools,
    });
    const providerTools = options.tools.map(toProviderTool);
    const toolsByName = new Map(options.tools.map((tool) => [tool.name, tool]));
    const toolContext = options.context;

    let iteration = 0;
    let contextOverflowRecoveryAttempted = false;
    for (;;) {
        if (options.signal?.aborted) {
            await appendSteering(options, transcript, contextTranscript, providerMessages, now);
            return {
                messages: transcript,
                contextMessages: contextTranscript,
                stopReason: "aborted",
            };
        }

        iteration += 1;
        await options.onEvent?.({
            type: "inference_iteration_start",
            iteration,
        });

        let assistantMessage: ProviderAssistantMessage;
        let pendingStartEvent: AgentLoopEvent | undefined;
        let deferredErrorEvents: AgentLoopEvent[] = [];
        let inferenceRetryCount = 0;
        try {
            for (;;) {
                pendingStartEvent = undefined;
                deferredErrorEvents = [];
                let emittedContent = false;
                try {
                    const preparedProviderMessages = await prepareProviderMessageImages(
                        providerMessages,
                        options.provider.id === "claude" ? "claude" : "codex",
                    );
                    const stream = options.provider.stream(
                        model,
                        toProviderContext(systemPrompt, preparedProviderMessages, providerTools),
                        toStreamOptions(options),
                    );

                    for await (const event of stream) {
                        if (event.type === "start") {
                            pendingStartEvent = event;
                            continue;
                        }
                        if (event.type === "error") {
                            deferredErrorEvents.push(event);
                            continue;
                        }
                        if (pendingStartEvent !== undefined) {
                            await options.onEvent?.(pendingStartEvent);
                            pendingStartEvent = undefined;
                        }
                        if (hasResponseContentBegun(event)) emittedContent = true;
                        await options.onEvent?.(event);
                    }

                    assistantMessage = await stream.result();
                } catch (error) {
                    if (
                        !emittedContent &&
                        inferenceRetryCount < INFERENCE_MAX_RETRIES &&
                        isRetryableInferenceError(error)
                    ) {
                        inferenceRetryCount += 1;
                        await delayBeforeInferenceRetry(inferenceRetryCount, options.signal);
                        continue;
                    }
                    throw error;
                }

                if (
                    assistantMessage.stopReason === "error" &&
                    inferenceRetryCount < INFERENCE_MAX_RETRIES &&
                    (assistantMessage.errorCode === "incomplete_response" ||
                        (!emittedContent && isRetryableInferenceError(assistantMessage)))
                ) {
                    inferenceRetryCount += 1;
                    if (assistantMessage.errorCode === "incomplete_response") {
                        await options.onEvent?.({
                            type: "inference_retry",
                            attempt: inferenceRetryCount,
                            maxAttempts: INFERENCE_MAX_RETRIES,
                            reason: "incomplete_response",
                        });
                    }
                    await delayBeforeInferenceRetry(inferenceRetryCount, options.signal);
                    continue;
                }
                break;
            }
        } catch (error) {
            if (options.signal?.aborted) {
                await appendSteering(options, transcript, contextTranscript, providerMessages, now);
                return {
                    messages: transcript,
                    contextMessages: contextTranscript,
                    stopReason: "aborted",
                };
            }

            if (isInvalidImageRequestError(error)) {
                const replacements = replaceLastTurnToolResultImages(transcript, "Invalid image");
                if (replacements.length > 0) {
                    replaceLastTurnToolResultImages(contextTranscript, "Invalid image");
                    providerMessages.splice(
                        0,
                        providerMessages.length,
                        ...toProviderMessages(contextTranscript, {
                            model,
                            now,
                            providerId: options.provider.id,
                        }),
                    );
                    for (const replacement of replacements) {
                        await options.onMessage?.(replacement);
                    }
                    continue;
                }
            }

            if (!contextOverflowRecoveryAttempted && isContextWindowExceededError(error)) {
                contextOverflowRecoveryAttempted = true;
                if (
                    await compactLoopContext(
                        options,
                        contextTranscript,
                        providerMessages,
                        model,
                        now,
                        { force: true },
                    )
                ) {
                    continue;
                }
            }

            throw error;
        }

        if (isInvalidImageRequestError(assistantMessage)) {
            const replacements = replaceLastTurnToolResultImages(transcript, "Invalid image");
            if (replacements.length > 0) {
                replaceLastTurnToolResultImages(contextTranscript, "Invalid image");
                providerMessages.splice(
                    0,
                    providerMessages.length,
                    ...toProviderMessages(contextTranscript, {
                        model,
                        now,
                        providerId: options.provider.id,
                    }),
                );
                for (const replacement of replacements) {
                    await options.onMessage?.(replacement);
                }
                continue;
            }
        }

        if (
            assistantMessage.stopReason === "error" &&
            !contextOverflowRecoveryAttempted &&
            isContextWindowExceededError(assistantMessage)
        ) {
            contextOverflowRecoveryAttempted = true;
            if (
                await compactLoopContext(options, contextTranscript, providerMessages, model, now, {
                    force: true,
                })
            ) {
                continue;
            }
        }

        if (pendingStartEvent !== undefined) {
            await options.onEvent?.(pendingStartEvent);
        }
        for (const event of deferredErrorEvents) {
            await options.onEvent?.(event);
        }

        const ambiguousToolCallRejection = createAmbiguousToolCallRejection(
            assistantMessage,
            idFactory,
            { providerId: options.provider.id, requestedModelId: model.id },
            collectToolCallIds(transcript),
        );
        if (ambiguousToolCallRejection !== undefined) {
            await options.onEvent?.({
                type: "tool_batch_rejected",
                toolCallIds: ambiguousToolCallRejection.originalToolCallIds,
            });
            transcript.push(
                ambiguousToolCallRejection.assistantMessage,
                ambiguousToolCallRejection.resultMessage,
            );
            contextTranscript.push(
                ambiguousToolCallRejection.assistantMessage,
                ambiguousToolCallRejection.resultMessage,
            );
            await options.onMessage?.(ambiguousToolCallRejection.assistantMessage);
            await options.onMessage?.(ambiguousToolCallRejection.resultMessage);
            return {
                messages: transcript,
                contextMessages: contextTranscript,
                stopReason: "error",
            };
        }

        providerMessages.push(assistantMessage);

        const agentMessage = assistantMessageToAgentMessage(assistantMessage, idFactory, {
            providerId: options.provider.id,
            requestedModelId: model.id,
        });
        transcript.push(agentMessage);
        contextTranscript.push(agentMessage);
        await options.onMessage?.(agentMessage);

        if (assistantMessage.stopReason === "aborted") {
            await appendSteering(options, transcript, contextTranscript, providerMessages, now);
            return {
                messages: transcript,
                contextMessages: contextTranscript,
                stopReason: assistantMessage.stopReason,
            };
        }

        if (assistantMessage.stopReason === "error") {
            return {
                messages: transcript,
                contextMessages: contextTranscript,
                stopReason: assistantMessage.stopReason,
            };
        }

        if (assistantMessage.stopReason !== "toolUse") {
            if (assistantMessage.endTurn === false) {
                await compactLoopContext(options, contextTranscript, providerMessages, model, now, {
                    force: false,
                    reportedTokens: assistantMessage.usage.totalTokens,
                });
                await appendSteering(options, transcript, contextTranscript, providerMessages, now);
                continue;
            }
            if (
                (await appendSteering(
                    options,
                    transcript,
                    contextTranscript,
                    providerMessages,
                    now,
                )) > 0
            ) {
                continue;
            }
            return {
                messages: transcript,
                contextMessages: contextTranscript,
                stopReason: assistantMessage.stopReason,
            };
        }

        const toolCalls = assistantMessage.content.filter(isProviderToolCall);
        if (toolCalls.length === 0) {
            return {
                messages: transcript,
                contextMessages: contextTranscript,
                stopReason: assistantMessage.stopReason,
            };
        }

        if (options.signal?.aborted) {
            const interrupted = await appendInterruptedToolResults({
                toolCalls,
                transcript,
                contextTranscript,
                providerMessages,
                idFactory,
                now,
                onMessage: options.onMessage,
            });
            await appendSteering(options, transcript, contextTranscript, providerMessages, now);
            return interrupted;
        }

        const toolResultBlocks = await Promise.all(
            toolCalls.map(async (toolCall) => {
                await options.debug?.record("tool-call", {
                    iteration,
                    toolCall,
                });
                await options.onEvent?.({ type: "tool_execution_start", toolCall });
                const result = await executeToolCall(toolCall, toolsByName, toolContext, {
                    messages: transcript,
                    model,
                    now,
                    onProgress: (display) => {
                        void options.onEvent?.({
                            type: "tool_execution_progress",
                            display,
                            toolCallId: toolCall.id,
                        });
                    },
                    onStatus: (status) => {
                        void options.onEvent?.({
                            type: "tool_execution_status",
                            status,
                            toolCallId: toolCall.id,
                        });
                    },
                    onPermissionReview: (review) =>
                        options.onEvent?.({
                            type: "permission_review",
                            toolCallId: toolCall.id,
                            ...review,
                        }),
                    onRawResult: (rawResult) =>
                        options.debug?.record("tool-raw-result", {
                            iteration,
                            rawResult,
                            toolCall,
                        }),
                    onError: (error) =>
                        options.debug?.record("tool-error", {
                            error,
                            iteration,
                            toolCall,
                        }),
                    provider: options.provider,
                    ...(options.signal === undefined ? {} : { signal: options.signal }),
                });
                await options.debug?.record("tool-result", {
                    iteration,
                    result,
                    toolCall,
                });
                await options.onEvent?.({
                    type: "tool_execution_end",
                    result: {
                        type: "tool_result",
                        toolCallId: result.toolCallId,
                        toolName: result.toolName,
                        display: result.display,
                        ...(result.isError === undefined ? {} : { isError: result.isError }),
                        ...(result.presentation === undefined
                            ? {}
                            : { presentation: result.presentation }),
                    },
                });
                await options.onEvent?.({
                    type: "background_processes_changed",
                    processes: toolContext.bash.activeSessions?.() ?? [],
                    running: toolContext.bash.activeSessionCount?.() ?? 0,
                });
                return result;
            }),
        );

        if (options.signal?.aborted) {
            return appendInterruptedToolResults({
                toolCalls,
                transcript,
                contextTranscript,
                providerMessages,
                idFactory,
                now,
                onMessage: options.onMessage,
            });
        }

        for (const resultBlock of toolResultBlocks) {
            providerMessages.push(toProviderToolResultMessage(resultBlock, now));
        }

        const toolResultMessage: AgentMessage = {
            role: "agent",
            id: idFactory(),
            blocks: toolResultBlocks,
        };
        transcript.push(toolResultMessage);
        contextTranscript.push(toolResultMessage);
        await options.onMessage?.(toolResultMessage);
        await compactLoopContext(options, contextTranscript, providerMessages, model, now, {
            force: false,
            reportedTokens: assistantMessage.usage.totalTokens,
        });
        await appendSteering(options, transcript, contextTranscript, providerMessages, now);
    }
}

async function compactLoopContext(
    options: RunAgentLoopOptions,
    contextTranscript: Message[],
    providerMessages: ProviderMessage[],
    model: Model,
    now: () => number,
    compaction: { force: boolean; reportedTokens?: number },
): Promise<boolean> {
    const result = await options.compactContext?.(contextTranscript, compaction);
    if (result?.compacted !== true) return false;

    contextTranscript.splice(0, contextTranscript.length, ...result.contextMessages);
    providerMessages.splice(
        0,
        providerMessages.length,
        ...toProviderMessages(contextTranscript, {
            model,
            now,
            providerId: options.provider.id,
        }),
    );
    return true;
}

function collectToolCallIds(messages: readonly Message[]): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const message of messages) {
        if (message.role !== "agent") continue;
        for (const block of message.blocks) {
            if (block.type === "tool_call") ids.add(block.id);
        }
    }
    return ids;
}

async function appendSteering(
    options: RunAgentLoopOptions,
    transcript: Message[],
    contextTranscript: Message[],
    providerMessages: ProviderMessage[],
    now: () => number,
): Promise<number> {
    const steering = options.takeSteering?.() ?? [];
    for (const message of steering) {
        transcript.push(message);
        contextTranscript.push(message);
        providerMessages.push(toProviderUserMessage(message, now));
    }
    if (steering.length > 0) {
        await options.onEvent?.({
            messageIds: steering.map((message) => message.id),
            type: "steering_applied",
        });
    }
    return steering.length;
}

async function appendInterruptedToolResults(options: {
    toolCalls: readonly ProviderToolCall[];
    transcript: Message[];
    contextTranscript: Message[];
    providerMessages: ProviderMessage[];
    idFactory: () => string;
    now: () => number;
    onMessage: ((message: Message) => void | Promise<void>) | undefined;
}): Promise<AgentLoopResult> {
    const toolResultBlocks = options.toolCalls.map(interruptedToolResultBlock);
    for (const resultBlock of toolResultBlocks) {
        options.providerMessages.push(toProviderToolResultMessage(resultBlock, options.now));
    }

    const toolResultMessage: AgentMessage = {
        role: "agent",
        id: options.idFactory(),
        blocks: toolResultBlocks,
    };
    options.transcript.push(toolResultMessage);
    options.contextTranscript.push(toolResultMessage);
    await options.onMessage?.(toolResultMessage);

    return {
        messages: options.transcript,
        contextMessages: options.contextTranscript,
        stopReason: "aborted",
    };
}

function findModel(provider: Provider, modelId: string): Model {
    const model = provider.models.find((candidate) => candidate.id === modelId);
    if (!model) {
        throw new Error(`Unknown model '${modelId}' for provider '${provider.id}'`);
    }

    return model;
}

function toStreamOptions(options: RunAgentLoopOptions): StreamOptions {
    return {
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
        ...(options.serviceTier !== undefined ? { serviceTier: options.serviceTier } : {}),
        ...(options.effort !== undefined ? { thinking: options.effort } : {}),
    };
}

function toProviderContext(
    systemPrompt: string | undefined,
    messages: readonly ProviderMessage[],
    tools: readonly ProviderTool[],
): ProviderContext {
    return {
        ...(systemPrompt !== undefined ? { systemPrompt } : {}),
        messages: [...messages],
        ...(tools.length > 0 ? { tools: [...tools] } : {}),
    };
}

function toProviderMessages(
    messages: readonly Message[],
    options: {
        model: Model;
        now: () => number;
        providerId: string;
    },
): ProviderMessage[] {
    const providerMessages: ProviderMessage[] = [];

    for (const message of messages) {
        if (message.role === "system") {
            continue;
        }

        if (message.role === "user") {
            providerMessages.push(toProviderUserMessage(message, options.now));
            continue;
        }

        providerMessages.push(...toProviderMessagesFromAgentMessage(message, options));
    }

    return providerMessages;
}

function toProviderUserMessage(message: UserMessage, now: () => number): ProviderMessage {
    return {
        role: "user",
        content: message.blocks.map(toProviderUserContent),
        timestamp: now(),
    };
}

function toProviderMessagesFromAgentMessage(
    message: AgentMessage,
    options: {
        model: Model;
        now: () => number;
        providerId: string;
    },
): ProviderMessage[] {
    const assistantContent: ProviderAssistantContent[] = [];
    const toolResults: ProviderToolResultMessage[] = [];

    for (const block of message.blocks) {
        if (block.type === "tool_result") {
            toolResults.push(toProviderToolResultMessage(block, options.now));
            continue;
        }

        assistantContent.push(toProviderAssistantContent(block));
    }

    const stopReason: StopReason = assistantContent.some(isProviderToolCall) ? "toolUse" : "stop";

    return [
        ...(assistantContent.length > 0
            ? [
                  {
                      role: "assistant" as const,
                      content: assistantContent,
                      api: "rig",
                      provider: options.providerId,
                      model: options.model.id,
                      usage: zeroUsage(),
                      stopReason,
                      timestamp: options.now(),
                  },
              ]
            : []),
        ...toolResults,
    ];
}

function toProviderUserContent(block: ContentBlock): ProviderUserContent {
    if (block.type === "text") {
        return {
            type: "text",
            text: block.text,
        };
    }

    return {
        type: "image",
        data: block.data,
        mimeType: block.mediaType,
        ...(block.detail !== undefined ? { detail: block.detail } : {}),
    };
}

function toProviderToolResultContent(block: ContentBlock): ProviderToolResultContent {
    return toProviderUserContent(block);
}

function toProviderAssistantContent(
    block: Exclude<AgentBlock, ToolResultBlock>,
): ProviderAssistantContent {
    if (block.type === "text") {
        return {
            type: "text",
            text: block.text,
        };
    }

    if (block.type === "thinking") {
        return {
            type: "thinking",
            thinking: block.thinking,
            ...(block.encrypted !== undefined ? { encrypted: block.encrypted } : {}),
            ...(block.redacted !== undefined ? { redacted: block.redacted } : {}),
        };
    }

    if (block.type === "tool_call") {
        return {
            type: "toolCall",
            id: block.id,
            name: block.name,
            arguments: block.arguments as Record<string, unknown>,
        };
    }

    throw new Error("Assistant image blocks are not supported by providers");
}

function toProviderTool(tool: AnyDefinedTool): ProviderTool {
    return {
        name: tool.name,
        description: tool.description,
        parameters: tool.arguments,
    };
}

function toProviderToolResultMessage(
    block: ToolResultBlock,
    now: () => number,
): ProviderToolResultMessage {
    return {
        role: "toolResult",
        toolCallId: block.toolCallId,
        toolName: block.toolName,
        content: block.rendered.map(toProviderToolResultContent),
        isError: block.isError ?? false,
        timestamp: now(),
    };
}

async function executeToolCall(
    toolCall: ProviderToolCall,
    toolsByName: ReadonlyMap<string, AnyDefinedTool>,
    context: AgentContext,
    options: {
        messages: readonly Message[];
        model: Model;
        now: () => number;
        onProgress?: (display: string) => void;
        onStatus?: (status: string) => void;
        onPermissionReview?: (review: {
            action: string;
            decision: "allow" | "ask";
            reason: string;
            risk: "low" | "medium" | "high";
            userAuthorization: "low" | "medium" | "high";
        }) => void | Promise<void>;
        onError?: (error: unknown) => void | Promise<void>;
        onRawResult?: (result: unknown) => void | Promise<void>;
        provider: Provider;
        signal?: AbortSignal;
    },
): Promise<ToolResultBlock> {
    const tool = toolsByName.get(toolCall.name);
    if (!tool) {
        return errorToolResultBlock(toolCall, `Unknown tool '${toolCall.name}' requested by model`);
    }

    if (!Value.Check(tool.arguments, toolCall.arguments)) {
        return errorToolResultBlock(toolCall, `Invalid arguments for tool '${tool.name}'`);
    }

    if (
        tool.requiresAutoOrFullAccess &&
        context.permissions?.mode !== undefined &&
        context.permissions.mode !== "auto" &&
        context.permissions.mode !== "full_access"
    ) {
        return errorToolResultBlock(
            toolCall,
            "MCP actions require Auto or Full access so Rig can disclose the unsandboxed boundary.",
        );
    }

    try {
        let runWithFullAccess = false;
        if (
            context.permissions?.mode === "auto" &&
            (await tool.shouldReviewInAutoMode(toolCall.arguments as never, context))
        ) {
            const review = await reviewAutoPermission({
                args: toolCall.arguments,
                messages: options.messages,
                model: options.model,
                now: options.now,
                provider: options.provider,
                ...(options.signal === undefined ? {} : { signal: options.signal }),
                toolName: tool.name,
            });
            const action =
                tool.describeAutoPermissionAction?.(toolCall.arguments as never, context) ??
                summarizePermissionAction(tool.name, toolCall.arguments);
            await options.onPermissionReview?.({
                action,
                decision: review.decision,
                reason: review.reason,
                risk: review.risk,
                userAuthorization: review.userAuthorization,
            });
            if (review.decision === "ask") {
                const approved = await requestAutoPermissionApproval({
                    action,
                    reason: review.reason,
                    ...(options.signal === undefined ? {} : { signal: options.signal }),
                    toolCallId: toolCall.id,
                    userInput: context.userInput,
                });
                if (!approved) {
                    return errorToolResultBlock(
                        toolCall,
                        `Auto mode did not approve ${action}. Reason: ${review.reason}`,
                    );
                }
            }
            runWithFullAccess = await tool.shouldRunInFullAccessInAutoMode(
                toolCall.arguments as never,
                context,
            );
        }

        const execute = tool.execute as (
            args: unknown,
            context: AgentContext,
            options: {
                messages?: readonly Message[];
                onProgress?: (display: string) => void;
                onStatus?: (status: string) => void;
                signal?: AbortSignal;
                toolCallId?: string;
            },
        ) => Promise<unknown> | unknown;
        const isError = tool.isError as ((result: unknown) => boolean) | undefined;
        const toLLM = tool.toLLM as (result: unknown) => readonly ContentBlock[];
        const toPresentation = tool.toPresentation as
            | ((result: unknown, args: unknown) => ToolResultBlock["presentation"])
            | undefined;
        const toTrustedUserEvidence = tool.toTrustedUserEvidence as
            | ((result: unknown, args: unknown) => readonly ContentBlock[])
            | undefined;
        const toUI = tool.toUI as (result: unknown, args: unknown) => string;
        const executionOptions: {
            messages?: readonly Message[];
            onProgress?: (display: string) => void;
            onStatus?: (status: string) => void;
            signal?: AbortSignal;
            toolCallId?: string;
        } = {
            messages: options.messages,
            toolCallId: toolCall.id,
        };
        if (options.onProgress !== undefined) executionOptions.onProgress = options.onProgress;
        if (options.onStatus !== undefined) executionOptions.onStatus = options.onStatus;
        if (options.signal !== undefined) executionOptions.signal = options.signal;
        const run = () => execute(toolCall.arguments, context, executionOptions);
        const result =
            runWithFullAccess && context.permissions !== undefined
                ? await context.permissions.runWithMode("full_access", run)
                : await run();
        await options.onRawResult?.(result);
        const resultIsError = isError?.(result);
        const presentation =
            resultIsError === true ? undefined : toPresentation?.(result, toolCall.arguments);
        const trustedUserEvidence =
            resultIsError === true
                ? undefined
                : toTrustedUserEvidence?.(result, toolCall.arguments);

        return {
            type: "tool_result",
            toolCallId: toolCall.id,
            toolName: tool.name,
            rendered: toLLM(result),
            display: toUI(result, toolCall.arguments),
            ...(resultIsError === undefined ? {} : { isError: resultIsError }),
            ...(presentation === undefined ? {} : { presentation }),
            ...(trustedUserEvidence === undefined ? {} : { trustedUserEvidence }),
        };
    } catch (error) {
        await options.onError?.(error);
        return errorToolResultBlock(
            toolCall,
            `Tool '${tool.name}' failed: ${errorToMessage(error)}`,
        );
    }
}

function errorToolResultBlock(toolCall: ProviderToolCall, message: string): ToolResultBlock {
    return {
        type: "tool_result",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        rendered: [
            {
                type: "text",
                text: message,
            },
        ],
        display: message,
        isError: true,
    };
}

function interruptedToolResultBlock(toolCall: ProviderToolCall): ToolResultBlock {
    if (toolCall.name === "wait_for_workflow" || toolCall.name === "WaitForWorkflow") {
        return errorToolResultBlock(
            toolCall,
            "The workflow wait was cancelled by the user. The workflow is still running in the background.",
        );
    }
    return errorToolResultBlock(toolCall, "Interrupted by user.");
}

function errorToMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function isProviderToolCall(content: ProviderAssistantContent): content is ProviderToolCall {
    return content.type === "toolCall";
}

function zeroUsage(): Usage {
    return {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
        },
    };
}
