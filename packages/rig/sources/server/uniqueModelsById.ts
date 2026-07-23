import type { Model } from "@slopus/rig-execution";

export function uniqueModelsById(models: readonly Model[]): readonly Model[] {
    return [...new Map(models.map((model) => [model.id, model])).values()];
}
