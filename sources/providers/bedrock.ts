import { BEDROCK_MODEL_ROUTES } from "./bedrock-model-routes.js";
import { createBedrockMantleStream } from "./createBedrockMantleStream.js";
import type { BedrockOpenAIClient } from "./createBedrockOpenAIClient.js";
import {
    createBedrockRuntimeStream,
    type PiBedrockRuntimeStream,
} from "./createBedrockRuntimeStream.js";
import { getBedrockModelRoute } from "./getBedrockModelRoute.js";
import { isBedrockModelAvailableInRegion } from "./isBedrockModelAvailableInRegion.js";
import { wrapPiStream } from "./pi-bridge.js";
import { readBedrockBearerToken } from "./readBedrockBearerToken.js";
import { resolveBedrockRegion } from "./resolveBedrockRegion.js";
import { defineProvider, type Provider } from "./types.js";

export const BEDROCK_PROVIDER_ID = "bedrock";

export interface BedrockProviderOptions {
    bearerToken?: string;
    env?: NodeJS.ProcessEnv;
    openAIClient?: BedrockOpenAIClient;
    region?: string;
    streamRuntime?: PiBedrockRuntimeStream;
}

export function createBedrockProvider(options: BedrockProviderOptions = {}): Provider {
    const env = options.env ?? process.env;
    const bearerToken = options.bearerToken ?? readBedrockBearerToken(env);
    if (bearerToken === undefined) {
        throw new Error(
            "Amazon Bedrock requires the AWS_BEARER_TOKEN_BEDROCK environment variable.",
        );
    }

    const region = options.region?.trim() || resolveBedrockRegion(env);
    const routes = BEDROCK_MODEL_ROUTES.filter((route) =>
        isBedrockModelAvailableInRegion(route, region),
    );

    return defineProvider({
        id: BEDROCK_PROVIDER_ID,
        models: routes.map((route) => route.model),
        stream(model, context, streamOptions) {
            const route = getBedrockModelRoute(model.id);
            if (route === undefined || !routes.includes(route)) {
                throw new Error(
                    `Amazon Bedrock model '${model.name}' is not available in ${region}.`,
                );
            }

            if (route.preferredEndpoint === "bedrock-runtime") {
                return wrapPiStream(
                    createBedrockRuntimeStream({
                        bearerToken,
                        context,
                        modelRoute: route,
                        region,
                        ...(options.streamRuntime !== undefined
                            ? { stream: options.streamRuntime }
                            : {}),
                        ...(streamOptions !== undefined ? { streamOptions } : {}),
                    }),
                );
            }

            return createBedrockMantleStream({
                bearerToken,
                context,
                modelRoute: route,
                region,
                ...(options.openAIClient !== undefined ? { client: options.openAIClient } : {}),
                ...(streamOptions !== undefined ? { streamOptions } : {}),
            });
        },
    });
}

export type BedrockProvider = ReturnType<typeof createBedrockProvider>;
