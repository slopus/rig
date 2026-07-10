import type { BedrockModelRoute } from "./bedrock-model-routes.js";

export function resolveBedrockRuntimeModelId(route: BedrockModelRoute, region: string): string {
    const profiles = route.runtimeInferenceProfiles;
    if (profiles === undefined) {
        return route.apiModelId;
    }

    const regionalProfile = Object.entries(profiles.regionPrefixes).find(([prefix]) =>
        region.startsWith(prefix),
    );
    return regionalProfile?.[1] ?? profiles.default;
}
