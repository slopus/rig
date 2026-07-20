import type {
    Model,
    ProviderContextCompatibility,
    ProviderContextCompatibilityKind,
} from "./types.js";

export interface ModelContextSelection {
    model: Model;
    providerContextCompatibility: ProviderContextCompatibility | undefined;
    providerContextCompatibilityKind?: ProviderContextCompatibilityKind | undefined;
    providerContextCompatibilityKey?: string | undefined;
    providerId: string;
}

export function areModelsContextCompatible(
    left: ModelContextSelection,
    right: ModelContextSelection,
): boolean {
    const group = left.model.contextCompatibilityGroup;
    const providerRouteCompatible =
        (left.providerId === right.providerId &&
            left.providerContextCompatibilityKey === right.providerContextCompatibilityKey) ||
        (group === "claude" &&
            ((left.providerContextCompatibilityKind === "claude_code" &&
                right.providerContextCompatibilityKind === "bedrock") ||
                (left.providerContextCompatibilityKind === "bedrock" &&
                    right.providerContextCompatibilityKind === "claude_code")));
    return (
        providerRouteCompatible &&
        left.providerContextCompatibility === "model_group" &&
        right.providerContextCompatibility === "model_group" &&
        group !== undefined &&
        group === right.model.contextCompatibilityGroup
    );
}
