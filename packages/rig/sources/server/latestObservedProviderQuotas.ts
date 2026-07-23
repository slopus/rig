import type { SessionEvent } from "../protocol/index.js";
import type { ProviderQuota } from "@slopus/rig-providers";

export function latestObservedProviderQuotas(
    events: readonly SessionEvent[],
): ReadonlyMap<string, ProviderQuota> {
    const latest = new Map<string, ProviderQuota>();
    for (const event of events) {
        if (event.type !== "provider_quota_observed") continue;
        const existing = latest.get(event.data.providerId);
        if (existing === undefined || event.data.quota.capturedAt >= existing.capturedAt) {
            latest.set(event.data.providerId, event.data.quota);
        }
    }
    return latest;
}
