import type { ModelCatalog } from "../protocol/index.js";

export function getProviderIdForModel(catalog: ModelCatalog, modelId: string): string | undefined {
    return catalog.providers.find((provider) =>
        provider.models.some((model) => model.id === modelId),
    )?.providerId;
}
