import type { BedrockModelOverrides } from "./bedrock-model-overrides.js";

export function resolveBedrockModelEndpoint(
    modelId: string,
    modelOverrides: BedrockModelOverrides = {},
): string | undefined {
    const endpoint = modelOverrides[modelId]?.endpoint?.trim();
    return endpoint === undefined || endpoint.length === 0 ? undefined : endpoint;
}
