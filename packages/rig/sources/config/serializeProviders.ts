import type { ConfigProvider, ConfigProviders } from "./types.js";

export function serializeProviders(providers: ConfigProviders): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(providers).map(([id, provider]) => [
            id,
            {
                ...(isBuiltInProvider(id, provider) ? {} : { type: provider.type }),
                enabled: provider.enabled,
                ...(provider.includeModels === undefined
                    ? {}
                    : { include_models: provider.includeModels }),
                ...(provider.excludeModels === undefined
                    ? {}
                    : { exclude_models: provider.excludeModels }),
                ...serializeProviderFields(provider),
            },
        ]),
    );
}

function isBuiltInProvider(id: string, provider: ConfigProvider): boolean {
    return (
        (id === "codex" && provider.type === "codex") ||
        (id === "claude" && provider.type === "claude") ||
        (id === "bedrock" && provider.type === "bedrock") ||
        (id === "grok" && provider.type === "grok")
    );
}

function serializeProviderFields(provider: ConfigProvider): Record<string, unknown> {
    if (provider.type === "codex") {
        return {
            ...(provider.authFile === undefined ? {} : { auth_file: provider.authFile }),
            ...(provider.baseUrl === undefined ? {} : { base_url: provider.baseUrl }),
            ...(provider.transport === undefined ? {} : { transport: provider.transport }),
        };
    }
    if (provider.type === "claude") {
        return {
            ...(provider.configDir === undefined ? {} : { config_dir: provider.configDir }),
            ...(provider.executable === undefined ? {} : { executable: provider.executable }),
        };
    }
    if (provider.type === "grok") {
        return {
            ...(provider.authFile === undefined ? {} : { auth_file: provider.authFile }),
            ...(provider.baseUrl === undefined ? {} : { base_url: provider.baseUrl }),
        };
    }
    return {
        ...(provider.bearerTokenEnvVar === undefined
            ? {}
            : { bearer_token_env_var: provider.bearerTokenEnvVar }),
        ...(provider.modelOverrides === undefined
            ? {}
            : { model_overrides: provider.modelOverrides }),
        ...(provider.region === undefined ? {} : { region: provider.region }),
    };
}
