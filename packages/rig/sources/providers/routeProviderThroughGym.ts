import { createGymProvider } from "./createGymProvider.js";
import { readGymContextWindow } from "./readGymContextWindow.js";
import type { Provider } from "./types.js";

export function routeProviderThroughGym(provider: Provider, env: NodeJS.ProcessEnv): Provider {
    const overrides = new Set(
        (env.RIG_GYM_PROVIDER_OVERRIDES ?? "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
    );
    if (!overrides.has(provider.id)) return provider;

    const endpoint = env.RIG_GYM_INFERENCE_URL;
    if (endpoint === undefined || endpoint.trim().length === 0) {
        throw new Error("RIG_GYM_INFERENCE_URL is required for Gym provider overrides.");
    }
    const contextWindow = readGymContextWindow(env);
    const gymProvider = createGymProvider({
        ...(contextWindow === undefined ? {} : { contextWindow }),
        endpoint,
        imageProfile: (model) => provider.imageProfile(model),
        models: provider.models,
        providerId: provider.id,
        toolProfile: (model) => provider.toolProfile(model),
        ...(provider.serviceTiers === undefined ? {} : { serviceTiers: provider.serviceTiers }),
        ...(env.RIG_GYM_TOKEN === undefined ? {} : { token: env.RIG_GYM_TOKEN }),
    });
    return {
        ...gymProvider,
        ...(provider.quota === undefined
            ? {}
            : { quota: (options?: { fresh?: boolean }) => provider.quota!(options) }),
        ...(provider.generateImage === undefined
            ? {}
            : { generateImage: provider.generateImage.bind(provider) }),
    };
}
