import type { BedrockModelOverrides } from "./bedrock-model-overrides.js";

export function resolveBedrockModelRegion(
    modelId: string,
    defaultRegion: string,
    modelOverrides: BedrockModelOverrides = {},
): string {
    return modelOverrides[modelId]?.region?.trim() || defaultRegion;
}
