import type { Model } from "../providers/types.js";

export function uniqueModelsById(models: readonly Model[]): readonly Model[] {
    return [...new Map(models.map((model) => [model.id, model])).values()];
}
