import { modelProfileSupportsEncryptedAgentMessages } from "../profiles/impl/modelProfileSupportsEncryptedAgentMessages.js";
import type { Model, Provider } from "./types.js";

export function createEncryptedAgentTransportScope(
    provider: Provider,
    model: Model,
): string | undefined {
    if (!modelProfileSupportsEncryptedAgentMessages(provider.profileType, model.id)) {
        return undefined;
    }
    return JSON.stringify([provider.id, provider.contextCompatibilityKey?.(model) ?? null]);
}
