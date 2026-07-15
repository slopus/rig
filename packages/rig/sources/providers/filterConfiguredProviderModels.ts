import type { ConfigProvider } from "../config/types.js";
import type { Provider } from "./types.js";

export function filterConfiguredProviderModels(
    provider: Provider,
    config: ConfigProvider,
    options: { allowEmpty?: boolean } = {},
): Provider {
    const included = config.includeModels === undefined ? undefined : new Set(config.includeModels);
    const excluded = new Set(config.excludeModels ?? []);
    const models = provider.models.filter(
        (model) => (included === undefined || included.has(model.id)) && !excluded.has(model.id),
    );
    if (models.length === 0 && options.allowEmpty !== true) {
        throw new Error(
            `Provider '${provider.id}' has no models after applying its model filters.`,
        );
    }
    return { ...provider, models };
}
