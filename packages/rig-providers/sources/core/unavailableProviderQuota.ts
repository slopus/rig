import type { ProviderQuota, ProviderQuotaSource } from "@/core/ProviderQuota.js";

export function unavailableProviderQuota(
    source: ProviderQuotaSource,
    capturedAt: number,
): ProviderQuota {
    return {
        capturedAt,
        source,
        windows: {
            fiveHour: { status: "unavailable" },
            weekly: { status: "unavailable" },
        },
    };
}
