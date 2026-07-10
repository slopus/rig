import { applyBedrockOpenAIResponse } from "./applyBedrockOpenAIResponse.js";
import type { ActiveBedrockOpenAIOutputItem } from "./bedrock-openai-types.js";
import type { BedrockModelRoute } from "./bedrock-model-routes.js";
import {
    createBedrockOpenAIClient,
    type BedrockOpenAIClient,
} from "./createBedrockOpenAIClient.js";
import { createBedrockOpenAIRequest } from "./createBedrockOpenAIRequest.js";
import { createInferenceStream } from "./createInferenceStream.js";
import { finishBedrockOpenAIOutputItem } from "./finishBedrockOpenAIOutputItem.js";
import { parseOpenAIToolArguments } from "./parseOpenAIToolArguments.js";
import { replaceAssistantContent } from "./replaceAssistantContent.js";
import { toBedrockAssistantContent } from "./toBedrockAssistantContent.js";
import type {
    AssistantMessage,
    AssistantMessageEvent,
    Context,
    StopReason,
    StreamOptions,
} from "./types.js";

export function createBedrockMantleStream(options: {
    bearerToken: string;
    client?: BedrockOpenAIClient;
    context: Context;
    modelRoute: BedrockModelRoute;
    region: string;
    streamOptions?: StreamOptions;
}): ReturnType<typeof createInferenceStream> {
    const client =
        options.client ??
        createBedrockOpenAIClient({
            bearerToken: options.bearerToken,
            region: options.region,
        });

    const run = async function* (): AsyncGenerator<AssistantMessageEvent, AssistantMessage> {
        const partial: AssistantMessage = {
            role: "assistant",
            content: [],
            api: "openai-responses",
            provider: "bedrock",
            model: options.modelRoute.model.id,
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
        const activeItems = new Map<number, ActiveBedrockOpenAIOutputItem>();
        yield { type: "start", partial };

        try {
            const responseStream = await client.responses.create(
                createBedrockOpenAIRequest({
                    context: options.context,
                    modelRoute: options.modelRoute,
                    ...(options.streamOptions !== undefined
                        ? { streamOptions: options.streamOptions }
                        : {}),
                }),
                ...(options.streamOptions?.signal !== undefined
                    ? [{ signal: options.streamOptions.signal }]
                    : []),
            );

            for await (const event of responseStream) {
                if (event.type === "response.created") {
                    partial.responseId = event.response.id;
                    partial.responseModel = event.response.model;
                    continue;
                }

                if (event.type === "response.output_item.added") {
                    const contentIndex = partial.content.length;
                    const content = toBedrockAssistantContent(event.item);
                    if (content === undefined) {
                        continue;
                    }

                    partial.content = [...partial.content, content];
                    const activeItem: ActiveBedrockOpenAIOutputItem = {
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

                    if (content.type === "thinking") {
                        yield { type: "thinking_start", contentIndex, partial };
                    } else if (content.type === "text") {
                        yield { type: "text_start", contentIndex, partial };
                    } else {
                        yield { type: "toolcall_start", contentIndex, partial };
                    }
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
                    if (activeItem?.type !== "reasoning" || content?.type !== "thinking") {
                        continue;
                    }

                    partial.content = replaceAssistantContent(
                        partial.content,
                        activeItem.contentIndex,
                        {
                            ...content,
                            thinking: content.thinking + event.delta,
                        },
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
                    if (activeItem?.type !== "reasoning" || content?.type !== "thinking") {
                        continue;
                    }

                    partial.content = replaceAssistantContent(
                        partial.content,
                        activeItem.contentIndex,
                        {
                            ...content,
                            thinking: `${content.thinking}\n\n`,
                        },
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
                    if (activeItem?.type !== "message" || content?.type !== "text") {
                        continue;
                    }

                    partial.content = replaceAssistantContent(
                        partial.content,
                        activeItem.contentIndex,
                        {
                            ...content,
                            text: content.text + event.delta,
                        },
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
                    if (activeItem?.type !== "toolCall" || content?.type !== "toolCall") {
                        continue;
                    }

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
                    if (activeItem?.type !== "toolCall" || content?.type !== "toolCall") {
                        continue;
                    }

                    activeItem.argumentsJson = event.arguments;
                    partial.content = replaceAssistantContent(
                        partial.content,
                        activeItem.contentIndex,
                        {
                            ...content,
                            arguments: parseOpenAIToolArguments(event.arguments),
                        },
                    );
                    continue;
                }

                if (event.type === "response.output_item.done") {
                    const activeItem = activeItems.get(event.output_index);
                    if (activeItem === undefined) {
                        continue;
                    }

                    const finishedEvent = finishBedrockOpenAIOutputItem(
                        partial,
                        activeItem,
                        event.item,
                    );
                    activeItems.delete(event.output_index);
                    if (finishedEvent !== undefined) {
                        yield finishedEvent;
                    }
                    continue;
                }

                if (event.type === "response.completed" || event.type === "response.incomplete") {
                    applyBedrockOpenAIResponse(partial, event.response);
                    yield {
                        type: "done",
                        reason: partial.stopReason as Extract<
                            StopReason,
                            "stop" | "length" | "toolUse"
                        >,
                        message: partial,
                    };
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
                            "Amazon Bedrock failed to generate a response.",
                    );
                }
            }

            partial.stopReason = partial.content.some((content) => content.type === "toolCall")
                ? "toolUse"
                : "stop";
            yield { type: "done", reason: partial.stopReason, message: partial };
            return partial;
        } catch (error) {
            const aborted = options.streamOptions?.signal?.aborted === true;
            partial.stopReason = aborted ? "aborted" : "error";
            partial.errorMessage = error instanceof Error ? error.message : String(error);
            yield {
                type: "error",
                reason: partial.stopReason,
                error: partial,
            };
            return partial;
        }
    };

    return createInferenceStream(run);
}
