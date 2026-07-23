import type { ProviderModelFamily } from "@/core/ProviderModelCompatibility.js";

export function providerModelFamily(modelId: string): ProviderModelFamily | undefined {
    if (modelId.startsWith("anthropic/")) return "claude";
    if (modelId.startsWith("openai/")) return "codex";
    if (modelId.startsWith("xai/")) return "grok";
    return undefined;
}
