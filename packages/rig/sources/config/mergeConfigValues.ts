import type { RigConfig, PartialRigConfig } from "./types.js";

export function mergeConfigValues(base: RigConfig, ...configs: PartialRigConfig[]): RigConfig {
    let docker = base.docker;
    const defaults = { ...base.defaults };
    const features = { ...base.features };
    const mcpServers = { ...base.mcpServers };
    const providers = { ...base.providers };
    const settings = { ...base.settings };
    const theme = { ...base.theme };

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
        if (config.settings?.showUsage !== undefined)
            settings.showUsage = config.settings.showUsage;
        if (config.features?.workflows !== undefined) {
            features.workflows = config.features.workflows;
        }
        if (config.providers !== undefined) Object.assign(providers, config.providers);
        if (config.theme !== undefined) Object.assign(theme, config.theme);
        if (config.mcpServers !== undefined) {
            Object.assign(mcpServers, config.mcpServers);
        }
    }

    return {
        defaults,
        features,
        mcpServers,
        providers,
        settings,
        theme,
        ...(docker === undefined ? {} : { docker }),
    };
}
