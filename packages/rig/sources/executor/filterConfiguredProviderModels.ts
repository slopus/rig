import type { ExecutorProvider } from "@slopus/rig-execution";

import type { ConfigProvider } from "../config/types.js";

export function filterConfiguredProviderModels(
    provider: ExecutorProvider,
    config: ConfigProvider,
    options: { allowEmpty?: boolean } = {},
): ExecutorProvider {
    const included = config.includeModels === undefined ? undefined : new Set(config.includeModels);
    const excluded = new Set(config.excludeModels ?? []);
    const filtered = {
        ...provider,
        profiles: provider.profiles.filter(
            (profile) =>
                (included === undefined || included.has(profile.id)) && !excluded.has(profile.id),
        ),
    };
    if (filtered.profiles.length === 0 && options.allowEmpty !== true) {
        throw new Error(
            `Provider '${provider.id}' has no models after applying its model filters.`,
        );
    }
    return filtered;
}
