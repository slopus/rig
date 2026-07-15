import type { ProviderQuota } from "./providerQuota.js";

export const DEFAULT_PROVIDER_QUOTA_STALE_AFTER_MS = 15 * 60 * 1_000;

export function isProviderQuotaStale(
    quota: ProviderQuota,
    now = Date.now(),
    staleAfterMs = DEFAULT_PROVIDER_QUOTA_STALE_AFTER_MS,
): boolean {
    return (
        now - quota.capturedAt >= staleAfterMs ||
        Object.values(quota.windows).some(
            (window) => window?.status === "available" && window.resetsAt <= now,
        )
    );
}
