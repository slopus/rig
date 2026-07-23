import type { ProviderQuota } from "@/core/ProviderQuota.js";
import {
    DEFAULT_PROVIDER_QUOTA_STALE_AFTER_MS,
    isProviderQuotaStale,
} from "@/core/isProviderQuotaStale.js";

export interface ProviderQuotaCache {
    get(options?: { fresh?: boolean }): Promise<ProviderQuota>;
    clear(): void;
}

export interface ProviderQuotaCacheOptions {
    now?: () => number;
    staleAfterMs?: number;
}

export function createProviderQuotaCache(
    load: () => Promise<ProviderQuota>,
    options: ProviderQuotaCacheOptions = {},
): ProviderQuotaCache {
    const now = options.now ?? Date.now;
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_PROVIDER_QUOTA_STALE_AFTER_MS;
    let cached: ProviderQuota | undefined;
    let pending: Promise<ProviderQuota> | undefined;
    let generation = 0;

    return {
        async get(getOptions = {}) {
            if (
                getOptions.fresh !== true &&
                cached !== undefined &&
                !isProviderQuotaStale(cached, now(), staleAfterMs)
            ) {
                return cached;
            }
            if (pending !== undefined) return pending;

            const loadGeneration = generation;
            const request = load()
                .then((quota) => {
                    if (loadGeneration === generation) cached = quota;
                    return quota;
                })
                .finally(() => {
                    if (pending === request) pending = undefined;
                });
            pending = request;
            return request;
        },
        clear() {
            generation += 1;
            cached = undefined;
            pending = undefined;
        },
    };
}
