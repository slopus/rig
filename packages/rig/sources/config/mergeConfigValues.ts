import type { PartialConfigProvider, RigConfig, PartialRigConfig } from "./types.js";

export function mergeConfigValues(
    baseDefaults: RigConfig,
    ...configs: PartialRigConfig[]
): RigConfig {
    let docker = baseDefaults.docker;
    const defaults = { ...baseDefaults.defaults };
    const features = { ...baseDefaults.features };
    const mcpServers = { ...baseDefaults.mcpServers };
    let providerDefaultEnable = baseDefaults.providerDefaultEnable;
    const providers: Record<string, PartialConfigProvider> = Object.fromEntries(
        Object.entries(baseDefaults.providers).map(([id, provider]) => {
            const { enabled: _enabled, ...settings } = provider;
            return [id, settings];
        }),
    );
    const providerEnabledOverrides = new Map<string, boolean>();
    const settings = { ...baseDefaults.settings };
    const theme = { ...baseDefaults.theme };

    for (const config of configs) {
        if (config.docker !== undefined) docker = config.docker;
        if (config.defaults?.modelId !== undefined) {
            defaults.modelId = config.defaults.modelId;
        }
        if (config.defaults?.providerId !== undefined) {
            defaults.providerId = config.defaults.providerId;
        }
        if (config.defaults?.effort !== undefined) {
            defaults.effort = config.defaults.effort;
        }
        if (config.defaults?.instructions !== undefined) {
            defaults.instructions = config.defaults.instructions;
        }
        if (config.defaults?.permissionMode !== undefined) {
            defaults.permissionMode = config.defaults.permissionMode;
        }
        if (config.defaults?.serviceTier === null) {
            delete defaults.serviceTier;
        } else if (config.defaults?.serviceTier !== undefined) {
            defaults.serviceTier = config.defaults.serviceTier;
        }
        if (config.settings?.compactCompletedTurns !== undefined) {
            settings.compactCompletedTurns = config.settings.compactCompletedTurns;
        }
        if (config.settings?.showReasoning !== undefined) {
            settings.showReasoning = config.settings.showReasoning;
        }
        if (config.settings?.completionChime !== undefined) {
            settings.completionChime = config.settings.completionChime;
        }
        if (config.settings?.durableGlobalEventQueue !== undefined) {
            settings.durableGlobalEventQueue = config.settings.durableGlobalEventQueue;
        }
        if (config.settings?.happyIntegration !== undefined) {
            settings.happyIntegration = config.settings.happyIntegration;
        }
        if (config.settings?.showUsage !== undefined)
            settings.showUsage = config.settings.showUsage;
        if (config.features?.workflows !== undefined) {
            features.workflows = config.features.workflows;
        }
        if (config.providerDefaultEnable !== undefined) {
            providerDefaultEnable = config.providerDefaultEnable;
        }
        if (config.providers !== undefined) {
            for (const [id, provider] of Object.entries(config.providers)) {
                providers[id] = provider;
                if (provider.enabled !== undefined) {
                    providerEnabledOverrides.set(id, provider.enabled);
                } else {
                    providerEnabledOverrides.delete(id);
                }
            }
        }
        if (config.theme !== undefined) Object.assign(theme, config.theme);
        if (config.mcpServers !== undefined) {
            Object.assign(mcpServers, config.mcpServers);
        }
    }

    return {
        defaults,
        features,
        mcpServers,
        providerDefaultEnable,
        providers: Object.fromEntries(
            Object.entries(providers).map(([id, provider]) => [
                id,
                {
                    ...provider,
                    enabled: providerEnabledOverrides.get(id) ?? providerDefaultEnable,
                },
            ]),
        ),
        settings,
        theme,
        ...(docker === undefined ? {} : { docker }),
    };
}
