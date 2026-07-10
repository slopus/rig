import type { OhMyPiConfig, PartialOhMyPiConfig } from "./types.js";

export function mergeConfigValues(
    base: OhMyPiConfig,
    ...configs: PartialOhMyPiConfig[]
): OhMyPiConfig {
    const defaults = { ...base.defaults };
    const settings = { ...base.settings };

    for (const config of configs) {
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
        if (config.settings?.showReasoning !== undefined) {
            settings.showReasoning = config.settings.showReasoning;
        }
    }

    return { defaults, settings };
}
