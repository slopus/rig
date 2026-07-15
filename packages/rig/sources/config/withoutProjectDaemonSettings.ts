import type { PartialRigConfig } from "./types.js";

export function withoutProjectDaemonSettings(config: PartialRigConfig): PartialRigConfig {
    const { providers: _providers, ...withoutProviders } = config;
    if (withoutProviders.settings?.durableGlobalEventQueue === undefined) {
        return withoutProviders;
    }
    const { durableGlobalEventQueue: _durableGlobalEventQueue, ...settings } =
        withoutProviders.settings;
    const { settings: _settings, ...rest } = withoutProviders;
    return Object.keys(settings).length === 0 ? rest : { ...rest, settings };
}
