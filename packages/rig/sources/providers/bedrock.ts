import { BEDROCK_MODEL_ROUTES } from "./bedrock-model-routes.js";
import type { BedrockModelOverrides } from "./bedrock-model-overrides.js";
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
import { resolveBedrockModelEndpoint } from "./resolveBedrockModelEndpoint.js";
import { resolveBedrockRegion } from "./resolveBedrockRegion.js";
import { resolveBedrockModelRegion } from "./resolveBedrockModelRegion.js";
import { defineProvider, type Provider } from "./types.js";

export const BEDROCK_PROVIDER_ID = "bedrock";

export interface BedrockProviderOptions {
    bearerToken?: string;
    env?: NodeJS.ProcessEnv;
    id?: string;
    modelOverrides?: BedrockModelOverrides;
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

    const defaultRegion = options.region?.trim() || resolveBedrockRegion(env);
    const routes = BEDROCK_MODEL_ROUTES.filter((route) => {
        const endpoint = resolveBedrockModelEndpoint(route.model.id, options.modelOverrides);
        return (
            endpoint !== undefined ||
            isBedrockModelAvailableInRegion(
                route,
                resolveBedrockModelRegion(route.model.id, defaultRegion, options.modelOverrides),
            )
        );
    });

    return defineProvider({
        id: options.id ?? BEDROCK_PROVIDER_ID,
        models: routes.map((route) => route.model),
        stream(model, context, streamOptions) {
            const endpoint = resolveBedrockModelEndpoint(model.id, options.modelOverrides);
            const region = resolveBedrockModelRegion(
                model.id,
                defaultRegion,
                options.modelOverrides,
            );
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
                        ...(endpoint === undefined ? {} : { endpoint }),
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
                ...(endpoint === undefined ? {} : { endpoint }),
                modelRoute: route,
                region,
                ...(options.openAIClient !== undefined ? { client: options.openAIClient } : {}),
                ...(streamOptions !== undefined ? { streamOptions } : {}),
            });
        },
    });
}

export type BedrockProvider = ReturnType<typeof createBedrockProvider>;
