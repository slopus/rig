import { createId } from "@paralleldrive/cuid2";
import { Value } from "@sinclair/typebox/value";

import { assistantMessageToAgentMessage } from "./assistantMessageToAgentMessage.js";
import { boundToolResultBlocks } from "./boundToolResultBlocks.js";
import { collectToolCallIds } from "./collectToolCallIds.js";
import { createAmbiguousToolCallRejection } from "./createAmbiguousToolCallRejection.js";
import { createErrorToolResultBlock } from "./createErrorToolResultBlock.js";
import { createToolResultBlock } from "./createToolResultBlock.js";
import type { AgentContext } from "./context/AgentContext.js";
import type { BashSessionActivity } from "./context/BashContext.js";
import { delayBeforeInferenceRetry } from "./delayBeforeInferenceRetry.js";
import { hasResponseContentBegun } from "./hasResponseContentBegun.js";
import { INFERENCE_MAX_RETRIES } from "./inferenceRetryPolicy.js";
import { isContextWindowExceededError } from "./isContextWindowExceededError.js";
import { isInvalidImageRequestError } from "./isInvalidImageRequestError.js";
import { isRetryableInferenceError } from "./isRetryableInferenceError.js";
import { prepareProviderMessageImages } from "./prepareProviderMessageImages.js";
import { presentToolCall, type PresentedToolCall } from "./presentToolCall.js";
import { replaceLastTurnToolResultImages } from "./replaceLastTurnToolResultImages.js";
import { createSystemPrompt } from "./createSystemPrompt.js";
import { ToolLockManager } from "./ToolLockManager.js";
import { toToolExecutionEndResult } from "./toToolExecutionEndResult.js";
import { errorToMessage } from "../errorToMessage.js";
import type {
    AgentBlock,
    AgentMessage,
    AnyDefinedTool,
    ContentBlock,
    Message,
    NestedToolInvocation,
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
import { toLocalDate } from "../providers/toLocalDate.js";
import { requestAutoPermissionApproval, reviewAutoPermission } from "../permissions/index.js";
import type { DebugLog } from "../debug/index.js";
import type { DurableSkillDefinition } from "../external-skills/types.js";

export interface RunAgentLoopOptions {
    appendSystemPrompt?: string;
    systemPrompt?: string;
    debug?: DebugLog;
    provider: Provider;
    modelId: string;
    effort?: string;
    serviceTier?: ServiceTier;
    tools: readonly AnyDefinedTool[];
    /** Logical tools used for system permission guidance when provider tools are adapters. */
    promptTools?: readonly AnyDefinedTool[];
    /** Tools available only to an exposed orchestration tool. */
    nestedTools?: readonly AnyDefinedTool[];
    durableSkills?: readonly DurableSkillDefinition[];
    instructions?: string;
    messages: readonly Message[];
    /** Model-facing history, when the visible transcript has been compacted. */
    contextMessages?: readonly Message[];
    compactContext?: (
        messages: readonly Message[],
        options: {
            createProviderContext: (messages: readonly Message[]) => Promise<ProviderContext>;
            force: boolean;
            reportedTokens?: number;
        },
    ) => Promise<
        | {
              compacted: boolean;
              contextMessages: readonly Message[];
          }
        | undefined
    >;
    signal?: AbortSignal;
    sessionId?: string;
    startDate?: string;
    idFactory?: () => string;
    now?: () => number;
    onEvent?: (event: AgentLoopEvent) => void | Promise<void>;
    onMessage?: (message: Message) => void | Promise<void>;
    /** Checkpoints model-only context before a recovery inference begins. */
    onContextChanged?: (messages: readonly Message[]) => void | Promise<void>;
    takeSteering?: () => readonly UserMessage[];
    /** Returns the signal aborted by the next scheduled steering message. */
    getSteeringSignal?: () => AbortSignal;
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
          reason: "connection_lost" | "incomplete_response";
      }
    | {
          type: "tool_execution_start";
          toolCall: PresentedToolCall;
      }
    | {
          type: "tool_execution_end";
          result: Pick<
              ToolResultBlock,
              | "display"
              | "failure"
              | "isError"
              | "presentation"
              | "toolCallId"
              | "toolName"
              | "type"
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

type PreparedToolPermission =
    | { kind: "skip" }
    | { kind: "error"; result: ToolResultBlock }
    | {
          action: string;
          kind: "review";
          review: {
              approvedByUser?: true;
              decision: "allow" | "ask";
              reason: string;
              risk: "low" | "medium" | "high";
              userAuthorization: "low" | "medium" | "high";
          };
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
    const startDate = options.startDate ?? toLocalDate(now());
    const transcript: Message[] = [...options.messages];
    const contextTranscript: Message[] = [...(options.contextMessages ?? options.messages)];
    const providerMessages = toProviderMessages(contextTranscript, {
        model,
        now,
        providerId: options.provider.id,
    });
    const systemPrompt = await createSystemPrompt({
        ...(options.appendSystemPrompt !== undefined
            ? { appendSystemPrompt: options.appendSystemPrompt }
            : {}),
        ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
        provider: options.provider,
        model,
        ...(options.instructions !== undefined ? { instructions: options.instructions } : {}),
        messages: contextTranscript,
        context: options.context,
        ...(options.effort === undefined ? {} : { effort: options.effort }),
        tools: options.promptTools ?? options.tools,
        ...(options.durableSkills === undefined ? {} : { durableSkills: options.durableSkills }),
    });
    const providerTools = options.tools.map(toProviderTool);
    const toolsByName = new Map(
        [...(options.nestedTools ?? []), ...options.tools].map((tool) => [
            toolDispatchKey(tool.name, tool.codeMode?.namespace),
            tool,
        ]),
    );
    const toolContext = options.context;
    const toolLocks = new ToolLockManager();
    const usedToolCallIds = collectToolCallIds(transcript);
    const compactCurrentContext = (compaction: { force: boolean; reportedTokens?: number }) =>
        compactLoopContext({
            compaction,
            contextTranscript,
            model,
            now,
            options,
            providerMessages,
            providerTools,
            systemPrompt,
        });

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
                let latestPartial: ProviderAssistantMessage | undefined;
                try {
                    const preparedProviderMessages = await prepareProviderMessageImages(
                        providerMessages,
                        options.provider.imageProfile(model),
                    );
                    const stream = options.provider.stream(
                        model,
                        toProviderContext(systemPrompt, preparedProviderMessages, providerTools),
                        toStreamOptions(options, startDate),
                    );

                    for await (const event of stream) {
                        if (event.type === "start") {
                            pendingStartEvent = event;
                            latestPartial = event.partial;
                            continue;
                        }
                        if (event.type === "error") {
                            latestPartial = event.error;
                            deferredErrorEvents.push(event);
                            continue;
                        }
                        if (pendingStartEvent !== undefined) {
                            await options.onEvent?.(pendingStartEvent);
                            pendingStartEvent = undefined;
                        }
                        if ("partial" in event) latestPartial = event.partial;
                        if (hasResponseContentBegun(event)) emittedContent = true;
                        await options.onEvent?.(event);
                    }

                    assistantMessage = await stream.result();
                } catch (error) {
                    if (
                        inferenceRetryCount < INFERENCE_MAX_RETRIES &&
                        isRetryableInferenceError(error)
                    ) {
                        inferenceRetryCount += 1;
                        if (emittedContent && latestPartial !== undefined) {
                            await appendInferenceCrashContinuation({
                                assistantMessage: latestPartial,
                                contextTranscript,
                                idFactory,
                                model,
                                now,
                                onContextChanged: options.onContextChanged,
                                onMessage: options.onMessage,
                                provider: options.provider,
                                providerMessages,
                                transcript,
                                toolContext,
                                tools: options.tools,
                                usedToolCallIds,
                            });
                        }
                        await options.onEvent?.({
                            type: "inference_retry",
                            attempt: inferenceRetryCount,
                            maxAttempts: INFERENCE_MAX_RETRIES,
                            reason: "connection_lost",
                        });
                        await delayBeforeInferenceRetry(inferenceRetryCount, options.signal);
                        if (emittedContent) {
                            iteration += 1;
                            await options.onEvent?.({
                                type: "inference_iteration_start",
                                iteration,
                            });
                        }
                        continue;
                    }
                    throw error;
                }

                if (
                    assistantMessage.stopReason === "error" &&
                    inferenceRetryCount < INFERENCE_MAX_RETRIES &&
                    (assistantMessage.errorCode === "incomplete_response" ||
                        isRetryableInferenceError(assistantMessage))
                ) {
                    inferenceRetryCount += 1;
                    if (emittedContent) {
                        await appendInferenceCrashContinuation({
                            assistantMessage,
                            contextTranscript,
                            idFactory,
                            model,
                            now,
                            onContextChanged: options.onContextChanged,
                            onMessage: options.onMessage,
                            provider: options.provider,
                            providerMessages,
                            transcript,
                            toolContext,
                            tools: options.tools,
                            usedToolCallIds,
                        });
                    }
                    await options.onEvent?.({
                        type: "inference_retry",
                        attempt: inferenceRetryCount,
                        maxAttempts: INFERENCE_MAX_RETRIES,
                        reason:
                            assistantMessage.errorCode === "incomplete_response"
                                ? "incomplete_response"
                                : "connection_lost",
                    });
                    await delayBeforeInferenceRetry(inferenceRetryCount, options.signal);
                    if (emittedContent) {
                        iteration += 1;
                        await options.onEvent?.({
                            type: "inference_iteration_start",
                            iteration,
                        });
                    }
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
                if (await compactCurrentContext({ force: true })) {
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
            if (await compactCurrentContext({ force: true })) {
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
            usedToolCallIds,
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
            await appendSteering(options, transcript, contextTranscript, providerMessages, now);
            return {
                messages: transcript,
                contextMessages: contextTranscript,
                stopReason: "error",
            };
        }

        providerMessages.push(assistantMessage);
        for (const block of assistantMessage.content) {
            if (block.type === "toolCall") usedToolCallIds.add(block.id);
        }

        const toolCalls = assistantMessage.content.filter(isProviderToolCall);
        const presentedToolCalls = new Map(
            toolCalls.map((toolCall) => [
                toolCall.id,
                presentToolCall(toolCall, options.tools, toolContext),
            ]),
        );
        const agentMessage = assistantMessageToAgentMessage(
            assistantMessage,
            idFactory,
            {
                providerId: options.provider.id,
                requestedModelId: model.id,
            },
            (toolCall) => presentedToolCalls.get(toolCall.id)?.presentation,
        );
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
            await appendSteering(options, transcript, contextTranscript, providerMessages, now);
            return {
                messages: transcript,
                contextMessages: contextTranscript,
                stopReason: assistantMessage.stopReason,
            };
        }

        if (assistantMessage.stopReason !== "toolUse") {
            if (assistantMessage.endTurn === false) {
                await compactCurrentContext({
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
                toolsByName,
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

        const preparedPermissions = new Map(
            await Promise.all(
                toolCalls.map(
                    async (toolCall) =>
                        [
                            toolCall.id,
                            await prepareToolPermission(toolCall, toolsByName, toolContext, {
                                messages: transcript,
                                model,
                                now,
                                onPermissionReview: (review) =>
                                    ignoreOptionalFailure(() =>
                                        options.onEvent?.({
                                            type: "permission_review",
                                            toolCallId: toolCall.id,
                                            ...review,
                                        }),
                                    ),
                                provider: options.provider,
                                startDate,
                                ...(options.signal === undefined ? {} : { signal: options.signal }),
                            }),
                        ] as const,
                ),
            ),
        );
        const executeToolCalls = (calls: readonly ProviderToolCall[]) =>
            Promise.all(
                calls.map(async (toolCall) => {
                    if (options.signal?.aborted) {
                        return {
                            completedBeforeAbort: false,
                            result: interruptedToolResultBlock(toolCall, toolsByName),
                            toolCall,
                        };
                    }
                    await ignoreOptionalFailure(() =>
                        options.debug?.record("tool-call", {
                            iteration,
                            toolCall,
                        }),
                    );
                    await ignoreOptionalFailure(() =>
                        options.onEvent?.({
                            type: "tool_execution_start",
                            toolCall: presentedToolCalls.get(toolCall.id) ?? toolCall,
                        }),
                    );
                    const toolCallIndex = toolCalls.indexOf(toolCall);
                    const preparedPermission = await resolvePermissionPrompt(
                        toolCall,
                        preparedPermissions.get(toolCall.id) ?? { kind: "skip" },
                        toolContext,
                        {
                            batchId: agentMessage.id,
                            toolCallIndex,
                            ...(options.signal === undefined ? {} : { signal: options.signal }),
                        },
                    );
                    return toolLocks.run(resolveToolLockKeys(toolCall, toolsByName), async () => {
                        if (options.signal?.aborted) {
                            return {
                                completedBeforeAbort: false,
                                result: interruptedToolResultBlock(toolCall, toolsByName),
                                toolCall,
                            };
                        }
                        const tool = resolveTool(toolCall, toolsByName);
                        const executionSignal = tool?.steerable
                            ? combineAbortSignals(options.signal, options.getSteeringSignal?.())
                            : options.signal;
                        const result = await executeToolCall(toolCall, toolsByName, toolContext, {
                            batchId: agentMessage.id,
                            messages: transcript,
                            model,
                            now,
                            toolCallIndex,
                            onProgress: (display) => {
                                void ignoreOptionalFailure(() =>
                                    options.onEvent?.({
                                        type: "tool_execution_progress",
                                        display,
                                        toolCallId: toolCall.id,
                                    }),
                                );
                            },
                            onStatus: (status) => {
                                void ignoreOptionalFailure(() =>
                                    options.onEvent?.({
                                        type: "tool_execution_status",
                                        status,
                                        toolCallId: toolCall.id,
                                    }),
                                );
                            },
                            onPermissionReview: (review) =>
                                ignoreOptionalFailure(() =>
                                    options.onEvent?.({
                                        type: "permission_review",
                                        toolCallId: toolCall.id,
                                        ...review,
                                    }),
                                ),
                            onRawResult: (rawResult) =>
                                ignoreOptionalFailure(() =>
                                    options.debug?.record("tool-raw-result", {
                                        iteration,
                                        rawResult,
                                        toolCall,
                                    }),
                                ),
                            onError: (error) =>
                                ignoreOptionalFailure(() =>
                                    options.debug?.record("tool-error", {
                                        error,
                                        iteration,
                                        toolCall,
                                    }),
                                ),
                            provider: options.provider,
                            preparedPermission,
                            invokeTool: (invocation) =>
                                invokeNestedTool(invocation, {
                                    batchId: agentMessage.id,
                                    messages: transcript,
                                    model,
                                    now,
                                    provider: options.provider,
                                    startDate,
                                    toolContext,
                                    toolLocks,
                                    toolsByName,
                                    ...(options.getSteeringSignal === undefined
                                        ? {}
                                        : { getSteeringSignal: options.getSteeringSignal }),
                                    ...(options.onEvent === undefined
                                        ? {}
                                        : { onEvent: options.onEvent }),
                                    ...(options.signal === undefined
                                        ? {}
                                        : { signal: options.signal }),
                                }),
                            ...(executionSignal === undefined ? {} : { signal: executionSignal }),
                        });
                        const completedBeforeAbort = options.signal?.aborted !== true;
                        const durableResult =
                            options.signal?.aborted && !completedBeforeAbort
                                ? interruptedToolResultBlock(toolCall, toolsByName)
                                : result;
                        await ignoreOptionalFailure(() =>
                            options.debug?.record("tool-result", {
                                iteration,
                                result: durableResult,
                                toolCall,
                            }),
                        );
                        await ignoreOptionalFailure(() =>
                            options.onEvent?.({
                                type: "tool_execution_end",
                                result: toToolExecutionEndResult(durableResult),
                            }),
                        );
                        await ignoreOptionalFailure(() =>
                            options.onEvent?.({
                                type: "background_processes_changed",
                                processes: toolContext.bash.activeSessions?.() ?? [],
                                running: toolContext.bash.activeSessionCount?.() ?? 0,
                            }),
                        );
                        return { completedBeforeAbort, result, toolCall };
                    });
                }),
            );
        const immediateCalls = toolCalls.filter(
            (toolCall) =>
                resolveTool(toolCall, toolsByName)?.execution !== "durable" &&
                !isPermissionPrompt(preparedPermissions.get(toolCall.id)),
        );
        const durableCalls = toolCalls.filter(
            (toolCall) =>
                resolveTool(toolCall, toolsByName)?.execution === "durable" ||
                isPermissionPrompt(preparedPermissions.get(toolCall.id)),
        );

        // Durable calls are an execution barrier. Finish and persist every immediate
        // result first, then publish all durable calls in parallel.
        for (const calls of [immediateCalls, durableCalls]) {
            if (calls.length === 0) continue;
            const outcomes = await executeToolCalls(calls);
            const toolResultBlocks = boundToolResultBlocks(
                outcomes.map((outcome) =>
                    options.signal?.aborted && !outcome.completedBeforeAbort
                        ? interruptedToolResultBlock(outcome.toolCall, toolsByName)
                        : outcome.result,
                ),
            );
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
        }
        if (options.signal?.aborted) {
            await appendSteering(options, transcript, contextTranscript, providerMessages, now);
            return {
                messages: transcript,
                contextMessages: contextTranscript,
                stopReason: "aborted",
            };
        }
        await compactCurrentContext({
            force: false,
            reportedTokens: assistantMessage.usage.totalTokens,
        });
        await appendSteering(options, transcript, contextTranscript, providerMessages, now);
    }
}

async function appendInferenceCrashContinuation(options: {
    assistantMessage: ProviderAssistantMessage;
    contextTranscript: Message[];
    idFactory: () => string;
    model: Model;
    now: () => number;
    onContextChanged: RunAgentLoopOptions["onContextChanged"];
    onMessage: RunAgentLoopOptions["onMessage"];
    provider: Provider;
    providerMessages: ProviderMessage[];
    transcript: Message[];
    toolContext: AgentContext;
    tools: readonly AnyDefinedTool[];
    usedToolCallIds: Set<string>;
}): Promise<void> {
    const resumableAssistant = toResumableAssistantMessage(options.assistantMessage);
    options.providerMessages.push(resumableAssistant);
    const agentMessage = assistantMessageToAgentMessage(
        resumableAssistant,
        options.idFactory,
        {
            providerId: options.provider.id,
            requestedModelId: options.model.id,
        },
        (toolCall) => presentToolCall(toolCall, options.tools, options.toolContext).presentation,
    );
    options.transcript.push(agentMessage);
    options.contextTranscript.push(agentMessage);

    const unexecutedToolCalls = resumableAssistant.content.filter(isProviderToolCall);
    if (unexecutedToolCalls.length > 0) {
        const resultBlocks = unexecutedToolCalls.map((toolCall) => {
            options.usedToolCallIds.add(toolCall.id);
            return createErrorToolResultBlock(
                toolCall,
                "Not run because the model connection was lost before the response completed.",
                { kind: "interrupted" },
            );
        });
        for (const resultBlock of resultBlocks) {
            options.providerMessages.push(toProviderToolResultMessage(resultBlock, options.now));
        }
        options.contextTranscript.push({
            role: "agent",
            id: options.idFactory(),
            internal: true,
            blocks: resultBlocks,
        });
    }

    const continuationUserMessage = options.provider.inferenceCrashContinuation?.userMessage;
    if (continuationUserMessage !== undefined) {
        const message: UserMessage = {
            role: "user",
            id: options.idFactory(),
            internal: true,
            blocks: [{ type: "text", text: continuationUserMessage }],
        };
        options.contextTranscript.push(message);
        options.providerMessages.push(toProviderUserMessage(message, options.now));
    }

    await options.onContextChanged?.(options.contextTranscript);
    await options.onMessage?.(agentMessage);
}

function toResumableAssistantMessage(message: ProviderAssistantMessage): ProviderAssistantMessage {
    const {
        errorCode: _errorCode,
        errorMessage: _errorMessage,
        providerError: _providerError,
        ...rest
    } = message;
    const content = message.content.map((block) =>
        block.type === "toolCall" ? { ...block, arguments: { ...block.arguments } } : { ...block },
    );
    return {
        ...rest,
        content,
        stopReason: content.some(isProviderToolCall) ? "toolUse" : "stop",
    };
}

async function ignoreOptionalFailure(callback: () => void | Promise<void>): Promise<void> {
    try {
        await callback();
    } catch {
        // Optional telemetry and live observers cannot invalidate durable tool execution.
    }
}

async function compactLoopContext(options: {
    compaction: { force: boolean; reportedTokens?: number };
    contextTranscript: Message[];
    model: Model;
    now: () => number;
    options: RunAgentLoopOptions;
    providerMessages: ProviderMessage[];
    providerTools: readonly ProviderTool[];
    systemPrompt: string | undefined;
}): Promise<boolean> {
    const result = await options.options.compactContext?.(options.contextTranscript, {
        ...options.compaction,
        createProviderContext: async (messages) => {
            const providerMessageCount = toProviderMessages(messages, {
                model: options.model,
                now: () => 0,
                providerId: options.options.provider.id,
            }).length;
            const preparedMessages = await prepareProviderMessageImages(
                options.providerMessages.slice(0, providerMessageCount),
                options.options.provider.imageProfile(options.model),
            );
            return toProviderContext(options.systemPrompt, preparedMessages, options.providerTools);
        },
    });
    if (result?.compacted !== true) return false;

    options.contextTranscript.splice(
        0,
        options.contextTranscript.length,
        ...result.contextMessages,
    );
    options.providerMessages.splice(
        0,
        options.providerMessages.length,
        ...toProviderMessages(options.contextTranscript, {
            model: options.model,
            now: options.now,
            providerId: options.options.provider.id,
        }),
    );
    return true;
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
    toolsByName: ReadonlyMap<string, AnyDefinedTool>;
    transcript: Message[];
    contextTranscript: Message[];
    providerMessages: ProviderMessage[];
    idFactory: () => string;
    now: () => number;
    onMessage: ((message: Message) => void | Promise<void>) | undefined;
}): Promise<AgentLoopResult> {
    const toolResultBlocks = options.toolCalls.map((toolCall) =>
        interruptedToolResultBlock(toolCall, options.toolsByName),
    );
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

function toStreamOptions(options: RunAgentLoopOptions, startDate: string): StreamOptions {
    return {
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
        ...(options.serviceTier !== undefined ? { serviceTier: options.serviceTier } : {}),
        startDate,
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

export function toProviderMessages(
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
        ...(message.encryptedAgentMessage === undefined
            ? {}
            : { encryptedAgentMessage: message.encryptedAgentMessage }),
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
    const toolResultBlocks: ToolResultBlock[] = [];

    for (const block of message.blocks) {
        if (block.type === "tool_result") {
            toolResultBlocks.push(block);
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
        ...boundToolResultBlocks(toolResultBlocks).map((block) =>
            toProviderToolResultMessage(block, options.now),
        ),
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
            ...(block.namespace === undefined ? {} : { namespace: block.namespace }),
            arguments: block.arguments as Record<string, unknown>,
            ...(block.kind === undefined ? {} : { kind: block.kind }),
        };
    }

    throw new Error("Assistant image blocks are not supported by providers");
}

function resolveToolLockKeys(
    toolCall: ProviderToolCall,
    toolsByName: ReadonlyMap<string, AnyDefinedTool>,
): readonly string[] {
    const tool = resolveTool(toolCall, toolsByName);
    if (tool === undefined || !Value.Check(tool.arguments, toolCall.arguments)) return [];
    return tool.locks.map((lock) =>
        typeof lock === "string" ? lock : lock(toolCall.arguments as never),
    );
}

export function toProviderTool(tool: AnyDefinedTool): ProviderTool {
    if (tool.providerTool !== undefined) return tool.providerTool;
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

function isPermissionPrompt(prepared: PreparedToolPermission | undefined): boolean {
    return prepared?.kind === "review" && prepared.review.decision === "ask";
}

async function resolvePermissionPrompt(
    toolCall: ProviderToolCall,
    prepared: PreparedToolPermission,
    context: AgentContext,
    options: {
        batchId: string;
        durable?: boolean;
        signal?: AbortSignal;
        toolCallIndex: number;
    },
): Promise<PreparedToolPermission> {
    if (!isPermissionPrompt(prepared) || prepared.kind !== "review") return prepared;
    const approved = await requestAutoPermissionApproval({
        action: prepared.action,
        batchId: options.batchId,
        ...(options.durable === undefined ? {} : { durable: options.durable }),
        reason: prepared.review.reason,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        toolArguments: toolCall.arguments,
        toolCallId: toolCall.id,
        toolCallIndex: options.toolCallIndex,
        toolName: toolCall.name,
        userInput: context.userInput,
    });
    if (!approved) {
        return {
            kind: "error",
            result: createErrorToolResultBlock(
                toolCall,
                `Auto mode did not approve ${prepared.action}. Reason: ${prepared.review.reason}`,
            ),
        };
    }
    return {
        ...prepared,
        review: { ...prepared.review, approvedByUser: true, decision: "allow" },
    };
}

async function prepareToolPermission(
    toolCall: ProviderToolCall,
    toolsByName: ReadonlyMap<string, AnyDefinedTool>,
    context: AgentContext,
    options: {
        messages: readonly Message[];
        model: Model;
        now: () => number;
        onPermissionReview?: (review: {
            action: string;
            decision: "allow" | "ask";
            reason: string;
            risk: "low" | "medium" | "high";
            userAuthorization: "low" | "medium" | "high";
        }) => void | Promise<void>;
        provider: Provider;
        signal?: AbortSignal;
        startDate: string;
    },
): Promise<PreparedToolPermission> {
    const tool = resolveTool(toolCall, toolsByName);
    if (
        tool === undefined ||
        !Value.Check(tool.arguments, toolCall.arguments) ||
        context.permissions?.mode !== "auto"
    ) {
        return { kind: "skip" };
    }
    try {
        if (!(await tool.shouldReviewInAutoMode(toolCall.arguments as never, context))) {
            return { kind: "skip" };
        }
        if (tool.describeAutoPermissionAction === undefined) {
            return {
                kind: "error",
                result: createErrorToolResultBlock(
                    toolCall,
                    "This tool cannot request Auto approval because its permission action is not defined.",
                ),
            };
        }
        const action = tool.describeAutoPermissionAction(toolCall.arguments as never, context);
        const review = await reviewAutoPermission({
            action,
            args: toolCall.arguments,
            messages: options.messages,
            model: options.model,
            now: options.now,
            provider: options.provider,
            startDate: options.startDate,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            toolName: tool.name,
        });
        await options.onPermissionReview?.({
            action,
            decision: review.decision,
            reason: review.reason,
            risk: review.risk,
            userAuthorization: review.userAuthorization,
        });
        return { action, kind: "review", review };
    } catch (error) {
        const message = errorToMessage(error);
        return {
            kind: "error",
            result: createErrorToolResultBlock(toolCall, `Tool '${tool.name}' failed: ${message}`, {
                kind: "execution_failed",
                message,
            }),
        };
    }
}

async function invokeNestedTool(
    invocation: NestedToolInvocation,
    options: {
        batchId: string;
        messages: readonly Message[];
        model: Model;
        now: () => number;
        onEvent?: (event: AgentLoopEvent) => void | Promise<void>;
        provider: Provider;
        getSteeringSignal?: () => AbortSignal;
        signal?: AbortSignal;
        startDate: string;
        toolContext: AgentContext;
        toolLocks: ToolLockManager;
        toolsByName: ReadonlyMap<string, AnyDefinedTool>;
    },
): Promise<unknown> {
    const invocationSignal = combineAbortSignals(options.signal, invocation.signal);
    const toolCall: ProviderToolCall = {
        type: "toolCall",
        id: invocation.toolCallId,
        name: invocation.name,
        ...(invocation.namespace === undefined ? {} : { namespace: invocation.namespace }),
        arguments: invocation.arguments as Record<string, unknown>,
    };
    const signal = resolveTool(toolCall, options.toolsByName)?.steerable
        ? combineAbortSignals(invocationSignal, options.getSteeringSignal?.())
        : invocationSignal;
    await ignoreOptionalFailure(() =>
        options.onEvent?.({ type: "tool_execution_start", toolCall }),
    );
    let endEmitted = false;
    const emitEnd = async (result: ToolResultBlock) => {
        endEmitted = true;
        await ignoreOptionalFailure(() =>
            options.onEvent?.({
                type: "tool_execution_end",
                result: toToolExecutionEndResult(result),
            }),
        );
        await ignoreOptionalFailure(() =>
            options.onEvent?.({
                type: "background_processes_changed",
                processes: options.toolContext.bash.activeSessions?.() ?? [],
                running: options.toolContext.bash.activeSessionCount?.() ?? 0,
            }),
        );
    };
    try {
        signal?.throwIfAborted();
        const prepared = await prepareToolPermission(
            toolCall,
            options.toolsByName,
            options.toolContext,
            {
                messages: options.messages,
                model: options.model,
                now: options.now,
                onPermissionReview: (review) =>
                    ignoreOptionalFailure(() =>
                        options.onEvent?.({
                            type: "permission_review",
                            toolCallId: toolCall.id,
                            ...review,
                        }),
                    ),
                provider: options.provider,
                startDate: options.startDate,
                ...(signal === undefined ? {} : { signal }),
            },
        );
        signal?.throwIfAborted();
        const permission = await resolvePermissionPrompt(toolCall, prepared, options.toolContext, {
            batchId: options.batchId,
            durable: false,
            toolCallIndex: 0,
            ...(signal === undefined ? {} : { signal }),
        });
        signal?.throwIfAborted();

        return await options.toolLocks.run(
            resolveToolLockKeys(toolCall, options.toolsByName),
            async () => {
                signal?.throwIfAborted();
                let rawResult: unknown;
                let hasRawResult = false;
                const result = await executeToolCall(
                    toolCall,
                    options.toolsByName,
                    options.toolContext,
                    {
                        batchId: options.batchId,
                        messages: options.messages,
                        model: options.model,
                        now: options.now,
                        preparedPermission: permission,
                        provider: options.provider,
                        toolCallIndex: 0,
                        markPermissionExecuting: false,
                        onPermissionReview: (review) =>
                            ignoreOptionalFailure(() =>
                                options.onEvent?.({
                                    type: "permission_review",
                                    toolCallId: toolCall.id,
                                    ...review,
                                }),
                            ),
                        onProgress: (display) => {
                            void ignoreOptionalFailure(() =>
                                options.onEvent?.({
                                    type: "tool_execution_progress",
                                    display,
                                    toolCallId: toolCall.id,
                                }),
                            );
                        },
                        onStatus: (status) => {
                            void ignoreOptionalFailure(() =>
                                options.onEvent?.({
                                    type: "tool_execution_status",
                                    status,
                                    toolCallId: toolCall.id,
                                }),
                            );
                        },
                        onRawResult: (value) => {
                            rawResult = value;
                            hasRawResult = true;
                        },
                        ...(signal === undefined ? {} : { signal }),
                    },
                );
                await emitEnd(result);
                if (!hasRawResult) throw new Error(result.display);
                return rawResult;
            },
        );
    } catch (error) {
        if (!endEmitted) {
            const message = errorToMessage(error);
            await emitEnd(
                createErrorToolResultBlock(toolCall, `Tool '${toolCall.name}' failed: ${message}`, {
                    kind: signal?.aborted ? "interrupted" : "execution_failed",
                    message,
                }),
            );
        }
        throw error;
    }
}

async function executeToolCall(
    toolCall: ProviderToolCall,
    toolsByName: ReadonlyMap<string, AnyDefinedTool>,
    context: AgentContext,
    options: {
        batchId: string;
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
        invokeTool?: (invocation: NestedToolInvocation) => Promise<unknown>;
        markPermissionExecuting?: boolean;
        preparedPermission: PreparedToolPermission;
        provider: Provider;
        signal?: AbortSignal;
        toolCallIndex: number;
    },
): Promise<ToolResultBlock> {
    const tool = resolveTool(toolCall, toolsByName);
    if (!tool) {
        return createErrorToolResultBlock(
            toolCall,
            `Unknown tool '${toolCall.name}' requested by model`,
            { kind: "tool_unavailable" },
        );
    }

    if (!Value.Check(tool.arguments, toolCall.arguments)) {
        return createErrorToolResultBlock(toolCall, `Invalid arguments for tool '${tool.name}'`, {
            kind: "invalid_arguments",
        });
    }

    if (context.permissions === undefined) {
        return createErrorToolResultBlock(
            toolCall,
            "This action requires an available permission context.",
        );
    }

    if (
        tool.requiresAutoOrFullAccess &&
        context.permissions.mode !== "auto" &&
        context.permissions.mode !== "full_access"
    ) {
        return createErrorToolResultBlock(
            toolCall,
            "This action requires Auto or Full access because it can operate outside Rig's local sandbox.",
        );
    }

    try {
        if (options.preparedPermission.kind === "error") {
            return options.preparedPermission.result;
        }
        let runWithFullAccess = false;
        if (options.preparedPermission.kind === "review") {
            const { review } = options.preparedPermission;
            if (review.decision === "ask") {
                return createErrorToolResultBlock(
                    toolCall,
                    `Tool '${tool.name}' could not resolve its Auto approval before execution.`,
                    { kind: "execution_failed" },
                );
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
                toolBatchId?: string;
                toolCallId?: string;
                toolCallIndex?: number;
                invokeTool?: (invocation: NestedToolInvocation) => Promise<unknown>;
            },
        ) => Promise<unknown> | unknown;
        const executionOptions: {
            messages?: readonly Message[];
            onProgress?: (display: string) => void;
            onStatus?: (status: string) => void;
            signal?: AbortSignal;
            toolBatchId?: string;
            toolCallId?: string;
            toolCallIndex?: number;
        } = {
            messages: options.messages,
            toolCallId: toolCall.id,
            ...(options.invokeTool === undefined ? {} : { invokeTool: options.invokeTool }),
        };
        if (tool.execution === "durable") {
            executionOptions.toolBatchId = options.batchId;
            executionOptions.toolCallIndex = options.toolCallIndex;
        }
        if (options.onProgress !== undefined) executionOptions.onProgress = options.onProgress;
        if (options.onStatus !== undefined) executionOptions.onStatus = options.onStatus;
        if (options.signal !== undefined) executionOptions.signal = options.signal;
        const run = () => execute(toolCall.arguments, context, executionOptions);
        if (runWithFullAccess && context.permissions?.mode !== "auto") {
            if (context.permissions?.mode !== "full_access") {
                return createErrorToolResultBlock(
                    toolCall,
                    `Tool '${tool.name}' was not run because the permission mode changed before its Auto-approved full-access execution began.`,
                    { kind: "interrupted" },
                );
            }
            runWithFullAccess = false;
        }
        if (
            options.markPermissionExecuting !== false &&
            options.preparedPermission.kind === "review" &&
            options.preparedPermission.review.approvedByUser
        ) {
            context.userInput?.markExecuting?.(`${toolCall.id}:permission`);
        }
        const result =
            runWithFullAccess && context.permissions !== undefined
                ? await context.permissions.runWithMode("full_access", run)
                : await run();
        options.signal?.throwIfAborted();
        await options.onRawResult?.(result);
        return createToolResultBlock(tool, toolCall.arguments, result, toolCall.id);
    } catch (error) {
        await options.onError?.(error);
        if (options.signal?.aborted) {
            return createErrorToolResultBlock(
                toolCall,
                tool.interruptionMessage ?? "Interrupted by user.",
                { kind: "interrupted" },
            );
        }
        const message = errorToMessage(error);
        return createErrorToolResultBlock(toolCall, `Tool '${tool.name}' failed: ${message}`, {
            kind: "execution_failed",
            message,
        });
    }
}

function combineAbortSignals(
    first: AbortSignal | undefined,
    second: AbortSignal | undefined,
): AbortSignal | undefined {
    if (first === undefined) return second;
    if (second === undefined || first === second) return first;
    return AbortSignal.any([first, second]);
}

function interruptedToolResultBlock(
    toolCall: ProviderToolCall,
    toolsByName: ReadonlyMap<string, AnyDefinedTool>,
): ToolResultBlock {
    const message =
        resolveTool(toolCall, toolsByName)?.interruptionMessage ?? "Interrupted by user.";
    return createErrorToolResultBlock(toolCall, message, { kind: "interrupted" });
}

function resolveTool(
    toolCall: Pick<ProviderToolCall, "name" | "namespace">,
    toolsByName: ReadonlyMap<string, AnyDefinedTool>,
): AnyDefinedTool | undefined {
    return toolsByName.get(toolDispatchKey(toolCall.name, toolCall.namespace));
}

function toolDispatchKey(name: string, namespace: string | undefined): string {
    return `${namespace ?? ""}\u0000${name}`;
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
