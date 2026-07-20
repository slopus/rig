import type { ModelCatalog } from "../protocol/index.js";

export function getProviderIdsForModel(catalog: ModelCatalog, modelId: string): readonly string[] {
    return catalog.providers
        .filter((provider) => provider.models.some((model) => model.id === modelId))
        .map((provider) => provider.providerId);
}
