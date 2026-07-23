export function resolveGrokModelId(modelId: string): string {
    return modelId.replace(/^xai\//u, "");
}
