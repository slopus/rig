export function encodeProviderModelSelection(providerId: string, modelId: string): string {
    return JSON.stringify([providerId, modelId]);
}
