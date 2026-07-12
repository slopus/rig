import type { PartialRigConfig } from "./types.js";

export function withoutProjectPermissionMode(config: PartialRigConfig): PartialRigConfig {
    if (config.defaults?.permissionMode === undefined) return config;
    const { permissionMode: _permissionMode, ...defaults } = config.defaults;
    const { defaults: _defaults, ...rest } = config;
    return Object.keys(defaults).length === 0 ? rest : { ...rest, defaults };
}
