import { createNodeAgentContext } from "../agent/index.js";
import { configuredProviderId } from "../config/configuredProviderId.js";
import { DEFAULT_RIG_CONFIG } from "../config/defaultConfig.js";
import type { ConfigProviders } from "../config/types.js";
import { NativeProxessManager } from "../processes/index.js";
import type { ModelCatalog } from "../protocol/index.js";
import { createBedrockProvider } from "../providers/bedrock.js";
import { createClaudeSdkProvider } from "../providers/claude-sdk.js";
import { createCodexProvider } from "../providers/codex.js";
import { createGymProvider } from "../providers/createGymProvider.js";
import { createGrokProvider } from "../providers/grok.js";
import { filterConfiguredProviderModels } from "../providers/filterConfiguredProviderModels.js";
import {
    modelOpenaiGpt56Luna,
    modelOpenaiGpt56Sol,
    modelOpenaiGpt56Terra,
} from "../providers/models.js";
import { readConfiguredBedrockBearerToken } from "../providers/readConfiguredBedrockBearerToken.js";
import { readGymContextWindow } from "../providers/readGymContextWindow.js";
import type { Model, Provider } from "../providers/types.js";
import { claudeCodeTools } from "../tools/claude/index.js";
import { uniqueModelsById } from "./uniqueModelsById.js";

export interface CreateModelCatalogOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    grokModelsByProviderId?: Readonly<Record<string, readonly Model[]>>;
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
    const gymEndpoint = env.RIG_GYM_INFERENCE_URL;
    const gymEnabled = gymEndpoint !== undefined && gymEndpoint.trim().length > 0;
    if (gymEnabled) {
        const contextWindow = readGymContextWindow(env);
        providers.unshift(
            createGymProvider({
                ...(contextWindow === undefined ? {} : { contextWindow }),
                endpoint: gymEndpoint,
                ...(env.RIG_GYM_TOKEN === undefined ? {} : { token: env.RIG_GYM_TOKEN }),
            }),
        );
    }
    for (const [configuredId, config] of Object.entries(providerSettings)) {
        if (!config.enabled) continue;
        const id = configuredProviderId(configuredId, config);
        if (providers.some((provider) => provider.id === id)) {
            throw new Error(`Inference provider '${id}' is configured more than once.`);
        }

        let provider: Provider;
        if (config.type === "codex") {
            provider = createCodexProvider({
                id,
                ...(config.authFile === undefined ? {} : { codexAuthPath: config.authFile }),
                ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
                ...(config.transport === undefined ? {} : { transport: config.transport }),
            });
        } else if (config.type === "claude") {
            provider = createClaudeSdkProvider({
                agentContext: context,
                env:
                    config.configDir === undefined
                        ? env
                        : { ...env, CLAUDE_CONFIG_DIR: config.configDir },
                id,
                ...(config.executable === undefined
                    ? {}
                    : { pathToClaudeCodeExecutable: config.executable }),
                tools: claudeCodeTools,
            });
        } else if (config.type === "grok") {
            const baseUrl = config.baseUrl ?? env.RIG_GROK_BASE_URL;
            provider = createGrokProvider({
                env,
                id,
                ...(options.grokModelsByProviderId?.[id] === undefined
                    ? {}
                    : { models: options.grokModelsByProviderId[id] }),
                ...(config.authFile === undefined ? {} : { authFile: config.authFile }),
                ...(baseUrl === undefined ? {} : { baseUrl }),
            });
        } else {
            const bearerToken = readConfiguredBedrockBearerToken(config, env);
            if (bearerToken === undefined) {
                missingCredentialVariables.add(
                    config.bearerTokenEnvVar ?? "AWS_BEARER_TOKEN_BEDROCK",
                );
                continue;
            }
            provider = createBedrockProvider({
                bearerToken,
                env,
                id,
                ...(config.modelOverrides === undefined
                    ? {}
                    : { modelOverrides: config.modelOverrides }),
                ...(config.region === undefined ? {} : { region: config.region }),
            });
        }
        const filteredProvider = filterConfiguredProviderModels(provider, config, {
            allowEmpty: true,
        });
        if (filteredProvider.models.length === 0) {
            emptyModelProviderIds.push(id);
            continue;
        }
        providers.push(filteredProvider);
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
