import type { OhMyPiConfig, PartialOhMyPiConfig } from "./types.js";

export function mergeConfigValues(
  base: OhMyPiConfig,
  ...configs: PartialOhMyPiConfig[]
): OhMyPiConfig {
  const defaults = { ...base.defaults };

  for (const config of configs) {
    if (config.defaults?.modelId !== undefined) {
      defaults.modelId = config.defaults.modelId;
    }
    if (config.defaults?.effort !== undefined) {
      defaults.effort = config.defaults.effort;
    }
    if (config.defaults?.instructions !== undefined) {
      defaults.instructions = config.defaults.instructions;
    }
  }

  return { defaults };
}
