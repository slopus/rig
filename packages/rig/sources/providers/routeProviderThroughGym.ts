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
        contextCompatibility: provider.contextCompatibility,
        ...(provider.contextCompatibilityKind === undefined
            ? {}
            : { contextCompatibilityKind: provider.contextCompatibilityKind }),
        ...(provider.contextCompatibilityKey === undefined
            ? {}
            : { contextCompatibilityKey: (model) => provider.contextCompatibilityKey!(model) }),
        ...(contextWindow === undefined ? {} : { contextWindow }),
        endpoint,
        ...(provider.extendProfilePromptContext === undefined
            ? {}
            : { extendProfilePromptContext: provider.extendProfilePromptContext }),
        imageProfile: (model) => provider.imageProfile(model),
        ...(provider.inferenceCrashContinuation === undefined
            ? {}
            : { inferenceCrashContinuation: provider.inferenceCrashContinuation }),
        models: provider.models,
        providerId: provider.id,
        ...(provider.profileType === undefined ? {} : { profileType: provider.profileType }),
        toolProfile: (model) => provider.toolProfile(model),
        ...(provider.serviceTiers === undefined ? {} : { serviceTiers: provider.serviceTiers }),
        ...(env.RIG_GYM_TOKEN === undefined ? {} : { token: env.RIG_GYM_TOKEN }),
    });
    return {
        ...gymProvider,
        ...(provider.close === undefined && gymProvider.close === undefined
            ? {}
            : {
                  close: async () => {
                      await Promise.all([gymProvider.close?.(), provider.close?.()]);
                  },
              }),
        ...(provider.quota === undefined
            ? {}
            : {
                  quota: (options?: Parameters<NonNullable<Provider["quota"]>>[0]) =>
                      provider.quota!(options),
              }),
    };
}
