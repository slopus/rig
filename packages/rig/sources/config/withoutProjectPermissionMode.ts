import type { PartialRigConfig } from "./types.js";

export function withoutProjectPermissionMode(config: PartialRigConfig): PartialRigConfig {
    const { docker: _docker, ...withoutDocker } = config;
    if (withoutDocker.defaults?.permissionMode === undefined) return withoutDocker;
    const { permissionMode: _permissionMode, ...defaults } = withoutDocker.defaults;
    const { defaults: _defaults, ...rest } = withoutDocker;
    return Object.keys(defaults).length === 0 ? rest : { ...rest, defaults };
}
