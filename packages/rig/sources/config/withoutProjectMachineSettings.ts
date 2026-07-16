import type { PartialRigConfig } from "./types.js";

export function withoutProjectMachineSettings(config: PartialRigConfig): PartialRigConfig {
    const {
        defaults: projectDefaults,
        docker: _docker,
        providers: _providers,
        settings: projectSettings,
        ...rest
    } = config;
    const { permissionMode: _permissionMode, ...defaults } = projectDefaults ?? {};
    const { durableGlobalEventQueue: _durableGlobalEventQueue, ...settings } =
        projectSettings ?? {};

    return {
        ...rest,
        ...(Object.keys(defaults).length === 0 ? {} : { defaults }),
        ...(Object.keys(settings).length === 0 ? {} : { settings }),
    };
}
