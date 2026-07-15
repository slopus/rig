import type { SessionEvent } from "../../protocol/index.js";
import type { ProviderQuota } from "../../providers/providerQuota.js";
import type { SessionQuotaContribution } from "./types.js";

interface ObservationPair {
    after?: ProviderQuota;
    before?: ProviderQuota;
    providerId: string;
}

export function aggregateQuotaContributions(
    events: readonly SessionEvent[],
): SessionQuotaContribution[] {
    let pairs = new Map<string, ObservationPair>();
    let contributions = new Map<string, SessionQuotaContribution>();
    const completed = new Set<string>();

    for (const event of events) {
        if (event.type === "session_reset") {
            pairs = new Map();
            contributions = new Map();
            completed.clear();
            continue;
        }
        if (event.type !== "provider_quota_observed") continue;
        if (completed.has(event.data.observationId)) continue;

        const pair = pairs.get(event.data.observationId) ?? {
            providerId: event.data.providerId,
        };
        if (pair.providerId !== event.data.providerId) continue;
        pair[event.data.phase] = event.data.quota;
        pairs.set(event.data.observationId, pair);
        if (pair.before === undefined || pair.after === undefined) continue;

        completed.add(event.data.observationId);
        pairs.delete(event.data.observationId);
        const contribution = contributions.get(pair.providerId) ?? {
            providerId: pair.providerId,
            windows: {},
        };
        addObservedDelta(contribution, "fiveHour", pair.before, pair.after);
        addObservedDelta(contribution, "weekly", pair.before, pair.after);
        if (
            contribution.windows.fiveHour !== undefined ||
            contribution.windows.weekly !== undefined
        ) {
            contributions.set(pair.providerId, contribution);
        }
    }

    return [...contributions.values()];
}

function addObservedDelta(
    contribution: SessionQuotaContribution,
    key: "fiveHour" | "weekly",
    before: ProviderQuota,
    after: ProviderQuota,
): void {
    const beforeWindow = before.windows[key];
    const afterWindow = after.windows[key];
    if (beforeWindow.status !== "available" || afterWindow.status !== "available") return;
    if (beforeWindow.resetsAt !== afterWindow.resetsAt) return;
    if (
        beforeWindow.durationMs !== undefined &&
        afterWindow.durationMs !== undefined &&
        beforeWindow.durationMs !== afterWindow.durationMs
    ) {
        return;
    }
    const delta = Math.max(0, afterWindow.usedPercent - beforeWindow.usedPercent);
    const previous = contribution.windows[key]?.observedUsedPercent ?? 0;
    contribution.windows[key] = { observedUsedPercent: previous + delta };
}
