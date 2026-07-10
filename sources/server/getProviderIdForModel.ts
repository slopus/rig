import type { ModelCatalog } from "../protocol/index.js";

export function getProviderIdForModel(
    catalog: ModelCatalog,
    modelId: string,
    preferredProviderId?: string,
): string | undefined {
    return catalog.providers.find(
        (provider) =>
            (preferredProviderId === undefined || provider.providerId === preferredProviderId) &&
            provider.models.some((model) => model.id === modelId),
    )?.providerId;
}
