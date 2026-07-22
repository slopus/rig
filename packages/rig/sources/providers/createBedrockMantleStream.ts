import type { BedrockModelRoute } from "./bedrock-model-routes.js";
import { createCodexBedrockRequestMetadata } from "./createCodexBedrockRequestMetadata.js";
import {
    createBedrockOpenAIClient,
    type BedrockOpenAIClient,
} from "./createBedrockOpenAIClient.js";
import { createBedrockOpenAIRequest } from "./createBedrockOpenAIRequest.js";
import { createOpenAIResponsesStream } from "./createOpenAIResponsesStream.js";
import type { Context, StreamOptions } from "./types.js";

export function createBedrockMantleStream(options: {
    agentId?: string;
    bearerToken: string;
    client?: BedrockOpenAIClient;
    context: Context;
    endpoint?: string;
    modelRoute: BedrockModelRoute;
    installationId?: string;
    region: string;
    streamOptions?: StreamOptions;
}): ReturnType<typeof createOpenAIResponsesStream> {
    const client =
        options.client ??
        createBedrockOpenAIClient({
            bearerToken: options.bearerToken,
            ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
            region: options.region,
        });

    const turnStartedAt = Date.now();
    const requestMetadata =
        options.agentId === undefined || options.installationId === undefined
            ? undefined
            : createCodexBedrockRequestMetadata({
                  agentId: options.agentId,
                  installationId: options.installationId,
                  turnId: options.streamOptions?.sessionId ?? options.agentId,
                  turnStartedAt,
              });
    return createOpenAIResponsesStream({
        createResponseStream: () =>
            client.responses.create(
                createBedrockOpenAIRequest({
                    ...(options.agentId === undefined ? {} : { agentId: options.agentId }),
                    context: options.context,
                    ...(options.installationId === undefined
                        ? {}
                        : { installationId: options.installationId }),
                    modelRoute: options.modelRoute,
                    turnStartedAt,
                    ...(options.streamOptions === undefined
                        ? {}
                        : { streamOptions: options.streamOptions }),
                }),
                ...(() => {
                    const requestOptions = {
                        ...(options.streamOptions?.signal === undefined
                            ? {}
                            : { signal: options.streamOptions.signal }),
                        ...(requestMetadata === undefined
                            ? {}
                            : { headers: requestMetadata.headers }),
                    };
                    return Object.keys(requestOptions).length === 0 ? [] : [requestOptions];
                })(),
            ),
        failureMessage: "Amazon Bedrock failed to generate a response.",
        modelId: options.modelRoute.model.id,
        providerId: "bedrock",
        ...(options.streamOptions?.signal === undefined
            ? {}
            : { signal: options.streamOptions.signal }),
    });
}
