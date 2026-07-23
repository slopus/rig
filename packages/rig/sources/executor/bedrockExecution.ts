import {
    BedrockBearerTokenCredential,
    BedrockProvider as NativeBedrockProvider,
} from "@slopus/rig-providers";
import { createExecutorModelProfiles, type ExecutorProvider } from "@slopus/rig-execution";

import { BEDROCK_MODEL_ROUTES } from "./bedrock-model-routes.js";
import type { BedrockModelOverrides } from "./bedrock-model-overrides.js";
import { getBedrockModelRoute } from "./getBedrockModelRoute.js";
import { isBedrockModelAvailableInRegion } from "./isBedrockModelAvailableInRegion.js";
import { readBedrockBearerToken } from "./readBedrockBearerToken.js";
import { resolveBedrockModelEndpoint } from "./resolveBedrockModelEndpoint.js";
import { resolveBedrockRegion } from "./resolveBedrockRegion.js";
import { resolveBedrockModelRegion } from "./resolveBedrockModelRegion.js";

export const BEDROCK_PROVIDER_ID = "bedrock";

export interface BedrockProviderOptions {
    agentId?: string;
    bearerToken?: string;
    env?: NodeJS.ProcessEnv;
    id?: string;
    modelOverrides?: BedrockModelOverrides;
    region?: string;
}

export function bedrockExecution(options: BedrockProviderOptions = {}): ExecutorProvider {
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

    const id = options.id ?? BEDROCK_PROVIDER_ID;
    return {
        id,
        profiles: createExecutorModelProfiles({
            models: routes.map((route) => route.model),
            providerId: id,
            providerType: "bedrock",
        }),
        sessionId: options.agentId ?? id,
        nativeKey: (profile) => {
            const endpoint = resolveBedrockModelEndpoint(profile.id, options.modelOverrides);
            const region = resolveBedrockModelRegion(
                profile.id,
                defaultRegion,
                options.modelOverrides,
            );
            return JSON.stringify([profile.id, endpoint, region]);
        },
        native: async (profile) => {
            const endpoint = resolveBedrockModelEndpoint(profile.id, options.modelOverrides);
            const region = resolveBedrockModelRegion(
                profile.id,
                defaultRegion,
                options.modelOverrides,
            );
            const route = getBedrockModelRoute(profile.id);
            if (route === undefined || !routes.includes(route)) {
                throw new Error(
                    `Amazon Bedrock model '${profile.name}' is not available in ${region}.`,
                );
            }
            const credential = await BedrockBearerTokenCredential.tryLoad({
                bearerToken,
            });
            if (credential === null) {
                throw new Error("Amazon Bedrock authentication is unavailable.");
            }
            return new NativeBedrockProvider({
                credential,
                ...(endpoint === undefined ? {} : { endpoint }),
                model: route.model.id,
                region,
            });
        },
    };
}
