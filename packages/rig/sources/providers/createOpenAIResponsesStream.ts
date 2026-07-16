import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";

import { errorToMessage } from "../errorToMessage.js";
import { applyOpenAIResponsesResponse } from "./applyOpenAIResponsesResponse.js";
import { createInferenceStream } from "./createInferenceStream.js";
import { finishOpenAIResponsesOutputItem } from "./finishOpenAIResponsesOutputItem.js";
import { getOpenAIResponsesIncompleteResponseReason } from "./getOpenAIResponsesIncompleteResponseReason.js";
import type { ActiveOpenAIResponsesOutputItem } from "./openai-responses-types.js";
import { parseOpenAIToolArguments } from "./parseOpenAIToolArguments.js";
import { replaceAssistantContent } from "./replaceAssistantContent.js";
import { toOpenAIResponsesAssistantContent } from "./toOpenAIResponsesAssistantContent.js";
import type { AssistantMessage, AssistantMessageEvent } from "./types.js";

export function createOpenAIResponsesStream(options: {
    createResponseStream: () =>
        | AsyncIterable<ResponseStreamEvent>
        | Promise<AsyncIterable<ResponseStreamEvent>>;
    failureMessage: string;
    modelId: string;
    providerId: string;
    signal?: AbortSignal;
}): ReturnType<typeof createInferenceStream> {
    const run = async function* (): AsyncGenerator<AssistantMessageEvent, AssistantMessage> {
        const partial: AssistantMessage = {
            role: "assistant",
            content: [],
            api: "openai-responses",
            provider: options.providerId,
            model: options.modelId,
            usage: {
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
            },
            stopReason: "stop",
            timestamp: Date.now(),
        };
        const activeItems = new Map<number, ActiveOpenAIResponsesOutputItem>();
        yield { type: "start", partial };

        try {
            const responseStream = await options.createResponseStream();
            for await (const event of responseStream) {
                if (event.type === "response.created") {
                    partial.responseId = event.response.id;
                    partial.responseModel = event.response.model;
                    continue;
                }

                if (event.type === "response.output_item.added") {
                    const contentIndex = partial.content.length;
                    const content = toOpenAIResponsesAssistantContent(event.item);
                    if (content === undefined) continue;

                    partial.content = [...partial.content, content];
                    const activeItem: ActiveOpenAIResponsesOutputItem = {
                        contentIndex,
                        type:
                            event.item.type === "reasoning"
                                ? "reasoning"
                                : event.item.type === "message"
                                  ? "message"
                                  : "toolCall",
                        ...(event.item.type === "function_call"
                            ? { argumentsJson: event.item.arguments }
                            : {}),
                    };
                    activeItems.set(event.output_index, activeItem);
                    yield content.type === "thinking"
                        ? { type: "thinking_start", contentIndex, partial }
                        : content.type === "text"
                          ? { type: "text_start", contentIndex, partial }
                          : { type: "toolcall_start", contentIndex, partial };
                    continue;
                }

                if (
                    event.type === "response.reasoning_summary_text.delta" ||
                    event.type === "response.reasoning_text.delta"
                ) {
                    const activeItem = activeItems.get(event.output_index);
                    const content =
                        activeItem === undefined
                            ? undefined
                            : partial.content[activeItem.contentIndex];
                    if (activeItem?.type !== "reasoning" || content?.type !== "thinking") continue;
                    partial.content = replaceAssistantContent(
                        partial.content,
                        activeItem.contentIndex,
                        { ...content, thinking: content.thinking + event.delta },
                    );
                    yield {
                        type: "thinking_delta",
                        contentIndex: activeItem.contentIndex,
                        delta: event.delta,
                        partial,
                    };
                    continue;
                }

                if (event.type === "response.reasoning_summary_part.done") {
                    const activeItem = activeItems.get(event.output_index);
                    const content =
                        activeItem === undefined
                            ? undefined
                            : partial.content[activeItem.contentIndex];
                    if (activeItem?.type !== "reasoning" || content?.type !== "thinking") continue;
                    partial.content = replaceAssistantContent(
                        partial.content,
                        activeItem.contentIndex,
                        { ...content, thinking: `${content.thinking}\n\n` },
                    );
                    yield {
                        type: "thinking_delta",
                        contentIndex: activeItem.contentIndex,
                        delta: "\n\n",
                        partial,
                    };
                    continue;
                }

                if (
                    event.type === "response.output_text.delta" ||
                    event.type === "response.refusal.delta"
                ) {
                    const activeItem = activeItems.get(event.output_index);
                    const content =
                        activeItem === undefined
                            ? undefined
                            : partial.content[activeItem.contentIndex];
                    if (activeItem?.type !== "message" || content?.type !== "text") continue;
                    partial.content = replaceAssistantContent(
                        partial.content,
                        activeItem.contentIndex,
                        { ...content, text: content.text + event.delta },
                    );
                    yield {
                        type: "text_delta",
                        contentIndex: activeItem.contentIndex,
                        delta: event.delta,
                        partial,
                    };
                    continue;
                }

                if (event.type === "response.function_call_arguments.delta") {
                    const activeItem = activeItems.get(event.output_index);
                    const content =
                        activeItem === undefined
                            ? undefined
                            : partial.content[activeItem.contentIndex];
                    if (activeItem?.type !== "toolCall" || content?.type !== "toolCall") continue;
                    activeItem.argumentsJson = (activeItem.argumentsJson ?? "") + event.delta;
                    partial.content = replaceAssistantContent(
                        partial.content,
                        activeItem.contentIndex,
                        {
                            ...content,
                            arguments: parseOpenAIToolArguments(activeItem.argumentsJson),
                        },
                    );
                    yield {
                        type: "toolcall_delta",
                        contentIndex: activeItem.contentIndex,
                        delta: event.delta,
                        partial,
                    };
                    continue;
                }

                if (event.type === "response.function_call_arguments.done") {
                    const activeItem = activeItems.get(event.output_index);
                    const content =
                        activeItem === undefined
                            ? undefined
                            : partial.content[activeItem.contentIndex];
                    if (activeItem?.type !== "toolCall" || content?.type !== "toolCall") continue;
                    activeItem.argumentsJson = event.arguments;
                    partial.content = replaceAssistantContent(
                        partial.content,
                        activeItem.contentIndex,
                        { ...content, arguments: parseOpenAIToolArguments(event.arguments) },
                    );
                    continue;
                }

                if (event.type === "response.output_item.done") {
                    const activeItem = activeItems.get(event.output_index);
                    if (activeItem === undefined) continue;
                    const finished = finishOpenAIResponsesOutputItem(
                        partial,
                        activeItem,
                        event.item,
                    );
                    activeItems.delete(event.output_index);
                    if (finished !== undefined) yield finished;
                    continue;
                }

                if (event.type === "response.incomplete") {
                    const reason = getOpenAIResponsesIncompleteResponseReason(event.response);
                    partial.errorCode = "incomplete_response";
                    throw new Error(`Incomplete response returned, reason: ${reason}`);
                }

                if (event.type === "response.completed") {
                    const reason = applyOpenAIResponsesResponse(partial, event.response);
                    yield { type: "done", reason, message: partial };
                    return partial;
                }

                if (event.type === "error") {
                    throw new Error(
                        event.code === null ? event.message : `${event.code}: ${event.message}`,
                    );
                }
                if (event.type === "response.failed") {
                    throw new Error(
                        event.response.error?.message ??
                            event.response.incomplete_details?.reason ??
                            options.failureMessage,
                    );
                }
            }

            partial.stopReason = partial.content.some((content) => content.type === "toolCall")
                ? "toolUse"
                : "stop";
            yield { type: "done", reason: partial.stopReason, message: partial };
            return partial;
        } catch (error) {
            const aborted = options.signal?.aborted === true;
            partial.stopReason = aborted ? "aborted" : "error";
            partial.errorMessage = errorToMessage(error);
            yield { type: "error", reason: partial.stopReason, error: partial };
            return partial;
        }
    };

    return createInferenceStream(run);
}
