import { applyBedrockOpenAIResponse } from "./applyBedrockOpenAIResponse.js";
import type { ActiveBedrockOpenAIOutputItem } from "./bedrock-openai-types.js";
import { createGrokOpenAIClient, type GrokOpenAIClient } from "./createGrokOpenAIClient.js";
import { createGrokOpenAIRequest } from "./createGrokOpenAIRequest.js";
import { createGrokRequestHeaders } from "./createGrokRequestHeaders.js";
import { createInferenceStream } from "./createInferenceStream.js";
import { finishBedrockOpenAIOutputItem } from "./finishBedrockOpenAIOutputItem.js";
import { parseOpenAIToolArguments } from "./parseOpenAIToolArguments.js";
import { replaceAssistantContent } from "./replaceAssistantContent.js";
import { resolveGrokCredential } from "./resolveGrokCredential.js";
import { toBedrockAssistantContent } from "./toBedrockAssistantContent.js";
import type {
    AssistantMessage,
    AssistantMessageEvent,
    Context,
    Model,
    StopReason,
    StreamOptions,
} from "./types.js";

export function createGrokStream(options: {
    apiKey?: string;
    apiModelId: string;
    authFile?: string;
    baseUrl: string;
    client?: GrokOpenAIClient;
    context: Context;
    env?: NodeJS.ProcessEnv;
    modelId: string;
    model: Model;
    providerId: string;
    resolveCredential?: typeof resolveGrokCredential;
    sessionId?: string;
    streamOptions?: StreamOptions;
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
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop",
            timestamp: Date.now(),
        };
        const activeItems = new Map<number, ActiveBedrockOpenAIOutputItem>();
        yield { type: "start", partial };

        try {
            const credential = await (options.resolveCredential ?? resolveGrokCredential)({
                ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
                ...(options.authFile === undefined ? {} : { authFile: options.authFile }),
                ...(options.env === undefined ? {} : { env: options.env }),
            });
            const sessionId = options.sessionId ?? options.streamOptions?.sessionId;
            const client =
                options.client ??
                createGrokOpenAIClient({
                    baseUrl: options.baseUrl,
                    headers: createGrokRequestHeaders({
                        baseUrl: options.baseUrl,
                        model: options.apiModelId,
                        ...(sessionId === undefined ? {} : { sessionId }),
                        turnIndex: options.context.messages.filter(
                            (message) => message.role === "assistant",
                        ).length,
                    }),
                    token: credential.token,
                });
            const responseStream = await client.responses.create(
                createGrokOpenAIRequest({
                    apiModelId: options.apiModelId,
                    context: options.context,
                    model: options.model,
                    ...(options.streamOptions === undefined
                        ? {}
                        : { streamOptions: options.streamOptions }),
                }),
                ...(options.streamOptions?.signal === undefined
                    ? []
                    : [{ signal: options.streamOptions.signal }]),
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
                    if (content === undefined) continue;

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
                    const finished = finishBedrockOpenAIOutputItem(partial, activeItem, event.item);
                    activeItems.delete(event.output_index);
                    if (finished !== undefined) yield finished;
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
                            "Grok Build failed to generate a response.",
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
            yield { type: "error", reason: partial.stopReason, error: partial };
            return partial;
        }
    };

    return createInferenceStream(run);
}
