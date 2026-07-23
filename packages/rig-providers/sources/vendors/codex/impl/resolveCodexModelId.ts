export function resolveCodexModelId(modelId: string): string {
    return modelId.replace(/^openai\//u, "");
}
