export type ProviderModelCompatibilityType = "bedrock" | "claude" | "codex" | "grok" | "gym";

export type ProviderModelFamily = "claude" | "codex" | "grok";

export interface ProviderModelSelection {
    modelId: string;
    providerId: string;
    providerType: ProviderModelCompatibilityType;
}

type CompatibilityRule = readonly ProviderModelFamily[];

export const PROVIDER_MODEL_COMPATIBILITY_MATRIX: Readonly<
    Record<
        ProviderModelCompatibilityType,
        Partial<Record<ProviderModelCompatibilityType, CompatibilityRule>>
    >
> = {
    bedrock: {
        bedrock: ["claude", "codex"],
        claude: ["claude"],
    },
    claude: {
        bedrock: ["claude"],
        claude: ["claude"],
    },
    codex: {
        codex: ["codex"],
    },
    grok: {
        grok: ["grok"],
    },
    gym: {
        gym: ["claude", "codex", "grok"],
    },
};

export function areProviderModelsCompatible(
    left: ProviderModelSelection,
    right: ProviderModelSelection,
): boolean {
    const leftFamily = providerModelFamily(left.modelId);
    const rightFamily = providerModelFamily(right.modelId);
    if (leftFamily === undefined || leftFamily !== rightFamily) return false;
    const compatibleFamilies =
        PROVIDER_MODEL_COMPATIBILITY_MATRIX[left.providerType][right.providerType];
    if (compatibleFamilies?.includes(leftFamily) !== true) return false;
    return left.providerType !== right.providerType || left.providerId === right.providerId;
}
import { providerModelFamily } from "@/core/providerModelFamily.js";
