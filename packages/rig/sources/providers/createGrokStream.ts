import type { GrokOpenAIClient } from "./createGrokOpenAIClient.js";
import { createGrokOpenAIRequest } from "./createGrokOpenAIRequest.js";
import { createGrokRequestHeaders } from "./createGrokRequestHeaders.js";
import { createOpenAIResponsesStream } from "./createOpenAIResponsesStream.js";
import type { Context, Model, StreamOptions } from "./types.js";

export function createGrokStream(options: {
    apiModelId: string;
    baseUrl: string;
    resolveClient: () => Promise<GrokOpenAIClient>;
    context: Context;
    modelId: string;
    model: Model;
    providerId: string;
    sessionId?: string;
    streamOptions?: StreamOptions;
}): ReturnType<typeof createOpenAIResponsesStream> {
    return createOpenAIResponsesStream({
        async createResponseStream() {
            const sessionId = options.sessionId ?? options.streamOptions?.sessionId;
            const client = await options.resolveClient();
            return client.responses.create(
                createGrokOpenAIRequest({
                    apiModelId: options.apiModelId,
                    context: options.context,
                    model: options.model,
                    ...(options.streamOptions === undefined
                        ? {}
                        : { streamOptions: options.streamOptions }),
                }),
                {
                    headers: createGrokRequestHeaders({
                        baseUrl: options.baseUrl,
                        model: options.apiModelId,
                        ...(sessionId === undefined ? {} : { sessionId }),
                        turnIndex: options.context.messages.filter(
                            (message) => message.role === "assistant",
                        ).length,
                    }),
                    ...(options.streamOptions?.signal === undefined
                        ? {}
                        : { signal: options.streamOptions.signal }),
                },
            );
        },
        failureMessage: `${options.model.name} failed to generate a response.`,
        modelId: options.modelId,
        providerId: options.providerId,
        ...(options.streamOptions?.signal === undefined
            ? {}
            : { signal: options.streamOptions.signal }),
    });
}
