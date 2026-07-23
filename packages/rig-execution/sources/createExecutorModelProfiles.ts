import type { ProviderModelCompatibilityType } from "@slopus/rig-providers";

import type { ExecutorModelProfile } from "@/ExecutorModelProfile.js";
import { builtinModelProfiles } from "@/builtinModelProfiles.js";
import type { Model } from "@/types.js";

export function createExecutorModelProfiles(options: {
    models: readonly Model[];
    providerId: string;
    providerType: ProviderModelCompatibilityType;
}): readonly ExecutorModelProfile[] {
    const builtins = new Map(
        builtinModelProfiles(options.providerId, options.providerType).map((profile) => [
            profile.id,
            profile,
        ]),
    );
    return options.models.map((model) => {
        const profile = builtins.get(model.id);
        if (profile === undefined) {
            throw new Error(`Executor has no built-in profile for model '${model.id}'.`);
        }
        return { ...profile, model, name: model.name };
    });
}
