import type { ProfileProviderType } from "./ProfileProviderType.js";
import { resolveModelProfile } from "./resolveModelProfile.js";

export function modelProfileSupportsEncryptedAgentMessages(
    providerType: ProfileProviderType | undefined,
    modelId: string,
): boolean {
    return (
        resolveModelProfile(providerType, modelId)?.parameters.referenceClient?.request
            .multiAgentVersion === "v2"
    );
}
