import type { Model, Provider } from "@slopus/rig-execution";

export function createEncryptedAgentTransportScope(
    provider: Provider,
    model: Model,
): string | undefined {
    if (provider.type !== "codex" || !model.id.startsWith("openai/gpt-5.6-")) {
        return undefined;
    }
    return provider.id;
}
