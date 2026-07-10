export interface ProviderModelSelection {
    modelId: string;
    providerId: string;
}

export function decodeProviderModelSelection(value: string): ProviderModelSelection | undefined {
    try {
        const parsed: unknown = JSON.parse(value);
        if (
            Array.isArray(parsed) &&
            parsed.length === 2 &&
            typeof parsed[0] === "string" &&
            typeof parsed[1] === "string"
        ) {
            return { providerId: parsed[0], modelId: parsed[1] };
        }
    } catch {
        return undefined;
    }
    return undefined;
}
