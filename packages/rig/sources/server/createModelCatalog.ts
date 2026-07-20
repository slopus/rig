import { createNodeAgentContext } from "../agent/index.js";
import { DEFAULT_RIG_CONFIG } from "../config/defaultConfig.js";
import type { ConfigProviders } from "../config/types.js";
import { NativeProcessManager } from "../processes/index.js";
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
    disabledProviderReasons?: ReadonlyMap<
        string,
        "not_authenticated" | "not_enabled" | "no_models"
    >;
    env?: NodeJS.ProcessEnv;
    providers?: ConfigProviders;
}

export function createModelCatalog(options: CreateModelCatalogOptions = {}): ModelCatalog {
    const cwd = options.cwd ?? process.cwd();
    const env = options.env ?? process.env;
    const providerSettings = options.providers ?? DEFAULT_RIG_CONFIG.providers;
    const context = createNodeAgentContext({
        cwd,
        processManager: new NativeProcessManager(),
    });
    const providers: Provider[] = [];
    const providerCatalogs: ModelCatalog["providers"][number][] = [];
    const emptyModelProviderIds: string[] = [];
    const missingCredentialVariables = new Set<string>();
    const gymProvider = createGymProviderFromEnvironment(env);
    const gymEnabled = gymProvider !== undefined;
    if (gymProvider !== undefined) {
        providers.unshift(gymProvider);
        providerCatalogs.unshift({
            contextCompatibility: gymProvider.contextCompatibility,
            ...(gymProvider.contextCompatibilityKind === undefined
                ? {}
                : { contextCompatibilityKind: gymProvider.contextCompatibilityKind }),
            ...(gymProvider.contextCompatibilityKey === undefined
                ? {}
                : {
                      contextCompatibilityKeys: Object.fromEntries(
                          gymProvider.models.map((model) => [
                              model.id,
                              gymProvider.contextCompatibilityKey!(model),
                          ]),
                      ),
                  }),
            models: gymProvider.models,
            providerId: gymProvider.id,
            ...(gymProvider.serviceTiers === undefined
                ? {}
                : { serviceTiers: gymProvider.serviceTiers }),
        });
    }
    for (const [configuredId, config] of Object.entries(providerSettings)) {
        const id = configuredId;
        if (providerCatalogs.some((provider) => provider.providerId === id)) {
            throw new Error(`Inference provider '${id}' is configured more than once.`);
        }
        const configuredDisabledReason = options.disabledProviderReasons?.get(id);
        const disabledReason = !config.enabled
            ? "not_enabled"
            : configuredDisabledReason === "not_enabled"
              ? "not_enabled"
              : configuredDisabledReason;
        if (disabledReason !== undefined) {
            if (disabledReason === "no_models") emptyModelProviderIds.push(id);
            providerCatalogs.push({ disabledReason, models: [], providerId: id });
            continue;
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
            providerCatalogs.push({
                disabledReason: "not_authenticated",
                models: [],
                providerId: id,
            });
            continue;
        }
        const provider = result.provider;
        if (provider.models.length === 0) {
            emptyModelProviderIds.push(id);
            providerCatalogs.push({ disabledReason: "no_models", models: [], providerId: id });
            continue;
        }
        providers.push(provider);
        providerCatalogs.push({
            contextCompatibility: provider.contextCompatibility,
            ...(provider.contextCompatibilityKind === undefined
                ? {}
                : { contextCompatibilityKind: provider.contextCompatibilityKind }),
            ...(provider.contextCompatibilityKey === undefined
                ? {}
                : {
                      contextCompatibilityKeys: Object.fromEntries(
                          provider.models.map((model) => [
                              model.id,
                              provider.contextCompatibilityKey!(model),
                          ]),
                      ),
                  }),
            models: provider.models,
            providerId: provider.id,
            ...(provider.serviceTiers === undefined ? {} : { serviceTiers: provider.serviceTiers }),
        });
    }

    const defaultProvider = providers[0];
    if (defaultProvider === undefined) {
        if (!Object.values(providerSettings).some((provider) => provider.enabled)) {
            throw new Error(
                "No inference providers are enabled. Enable at least one provider in your machine-wide configuration.",
            );
        }
        const unavailableReasons: string[] = [];
        const unauthenticatedProviderIds = [...(options.disabledProviderReasons ?? [])].flatMap(
            ([id, reason]) => (reason === "not_authenticated" ? [id] : []),
        );
        if (unauthenticatedProviderIds.length > 0) {
            unavailableReasons.push(
                `${unauthenticatedProviderIds.length === 1 ? "Provider" : "Providers"} ${unauthenticatedProviderIds.map((id) => `'${id}'`).join(", ")} ${unauthenticatedProviderIds.length === 1 ? "has" : "have"} no local authentication. Sign in through the corresponding coding assistant or configure its credential.`,
            );
        }
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
        throw new Error(
            `No inference providers are available.${unavailableReasons.length === 0 ? "" : ` ${unavailableReasons.join(" ")}`}`,
        );
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
        providers: providerCatalogs,
    };
}
