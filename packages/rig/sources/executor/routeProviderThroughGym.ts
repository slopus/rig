import { createGymProvider } from "./createGymProvider.js";
import { readGymContextWindow } from "./readGymContextWindow.js";
import type { Provider } from "@slopus/rig-execution";
import { Executor } from "@slopus/rig-execution";

export function routeProviderThroughGym(provider: Provider, env: NodeJS.ProcessEnv): Provider {
    const overrides = new Set(
        (env.RIG_GYM_PROVIDER_OVERRIDES ?? "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
    );
    if (!overrides.has(provider.id)) return provider;

    const endpoint = env.RIG_GYM_INFERENCE_URL?.trim();
    if (endpoint === undefined || endpoint.length === 0) {
        throw new Error("RIG_GYM_INFERENCE_URL is required for Gym provider overrides.");
    }
    const contextWindow = readGymContextWindow(env);
    const gymProvider = createGymProvider({
        ...(contextWindow === undefined ? {} : { contextWindow }),
        endpoint,
        ...(provider.extendProfilePromptContext === undefined
            ? {}
            : { extendProfilePromptContext: provider.extendProfilePromptContext }),
        models: provider.models,
        ...(provider instanceof Executor
            ? {
                  prepareContext: async (model, context) => ({
                      ...context,
                      systemPrompt: await provider.systemPrompt(
                          { modelId: model.id, providerId: provider.id },
                          context.systemPrompt,
                          context.systemPromptOverride,
                      ),
                  }),
              }
            : {}),
        providerId: provider.id,
        ...(provider.type === undefined ? {} : { providerType: provider.type }),
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
