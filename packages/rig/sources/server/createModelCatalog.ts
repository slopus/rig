import { createNodeAgentContext } from "../agent/index.js";
import { DEFAULT_RIG_CONFIG } from "../config/defaultConfig.js";
import type { ConfigProviders } from "../config/types.js";
import { NativeProxessManager } from "../processes/index.js";
import type { ModelCatalog } from "../protocol/index.js";
import { createConfiguredProvider } from "../providers/createConfiguredProvider.js";
import { createGymProviderFromEnvironment } from "../providers/createGymProviderFromEnvironment.js";
import {
    modelOpenaiGpt56Luna,
    modelOpenaiGpt56Sol,
    modelOpenaiGpt56Terra,
} from "../providers/models.js";
import type { Provider } from "../providers/types.js";
import { uniqueModelsById } from "./uniqueModelsById.js";

export interface CreateModelCatalogOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    providers?: ConfigProviders;
}

export function createModelCatalog(options: CreateModelCatalogOptions = {}): ModelCatalog {
    const cwd = options.cwd ?? process.cwd();
    const env = options.env ?? process.env;
    const providerSettings = options.providers ?? DEFAULT_RIG_CONFIG.providers;
    const context = createNodeAgentContext({
        cwd,
        processManager: new NativeProxessManager(),
    });
    const providers: Provider[] = [];
    const emptyModelProviderIds: string[] = [];
    const missingCredentialVariables = new Set<string>();
    const gymProvider = createGymProviderFromEnvironment(env);
    const gymEnabled = gymProvider !== undefined;
    if (gymProvider !== undefined) providers.unshift(gymProvider);
    for (const [configuredId, config] of Object.entries(providerSettings)) {
        if (!config.enabled) continue;
        const id = configuredId;
        if (providers.some((provider) => provider.id === id)) {
            throw new Error(`Inference provider '${id}' is configured more than once.`);
        }

        const result = createConfiguredProvider({
            agentContext: context,
            allowEmptyModels: true,
            config,
            env,
            id,
        });
        if (result.status === "missing_credential") {
            missingCredentialVariables.add(result.variable);
            continue;
        }
        const provider = result.provider;
        if (provider.models.length === 0) {
            emptyModelProviderIds.push(id);
            continue;
        }
        providers.push(provider);
    }

    const defaultProvider = providers[0];
    if (defaultProvider === undefined) {
        if (!Object.values(providerSettings).some((provider) => provider.enabled)) {
            throw new Error(
                "No inference providers are enabled. Enable at least one provider in your machine-wide configuration.",
            );
        }
        const unavailableReasons: string[] = [];
        if (emptyModelProviderIds.length > 0) {
            unavailableReasons.push(
                `${emptyModelProviderIds.length === 1 ? "Provider" : "Providers"} ${emptyModelProviderIds.map((id) => `'${id}'`).join(", ")} ${emptyModelProviderIds.length === 1 ? "has" : "have"} no models after applying model filters and regional availability.`,
            );
        }
        const credentialVariables = [...missingCredentialVariables];
        if (credentialVariables.length > 0) {
            unavailableReasons.push(
                `Set ${credentialVariables.join(", ")} for the enabled Amazon Bedrock provider${credentialVariables.length === 1 ? "" : "s"}, or enable Codex or Claude Code.`,
            );
        }
        throw new Error(`No inference providers are available. ${unavailableReasons.join(" ")}`);
    }
    const defaultModel = gymEnabled
        ? (defaultProvider.models.find((model) => model.id === "openai/gym") ??
          defaultProvider.models[0])
        : (defaultProvider.models.find((model) => model.id === modelOpenaiGpt56Sol.id) ??
          defaultProvider.models.find((model) => model.id === modelOpenaiGpt56Terra.id) ??
          defaultProvider.models.find((model) => model.id === modelOpenaiGpt56Luna.id) ??
          defaultProvider.models[0]);
    if (defaultModel === undefined) {
        throw new Error("No inference models are currently available.");
    }

    return {
        defaultModelId: defaultModel.id,
        defaultProviderId: defaultProvider.id,
        models: uniqueModelsById(providers.flatMap((provider) => provider.models)),
        providers: providers.map((provider) => ({
            providerId: provider.id,
            models: provider.models,
            ...(provider.serviceTiers === undefined ? {} : { serviceTiers: provider.serviceTiers }),
        })),
    };
}
