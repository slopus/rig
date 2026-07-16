import { createGrokOpenAIClient, type GrokOpenAIClient } from "./createGrokOpenAIClient.js";
import { createGrokOpenAIRequest } from "./createGrokOpenAIRequest.js";
import { createGrokRequestHeaders } from "./createGrokRequestHeaders.js";
import { createOpenAIResponsesStream } from "./createOpenAIResponsesStream.js";
import { resolveGrokCredential } from "./resolveGrokCredential.js";
import type { Context, Model, StreamOptions } from "./types.js";

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
}): ReturnType<typeof createOpenAIResponsesStream> {
    return createOpenAIResponsesStream({
        async createResponseStream() {
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
            return client.responses.create(
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
        },
        failureMessage: `${options.model.name} failed to generate a response.`,
        modelId: options.modelId,
        providerId: options.providerId,
        ...(options.streamOptions?.signal === undefined
            ? {}
            : { signal: options.streamOptions.signal }),
    });
}
