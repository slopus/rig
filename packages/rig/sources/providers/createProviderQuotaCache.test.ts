import { describe, expect, it, vi } from "vitest";

import { createProviderQuotaCache } from "./createProviderQuotaCache.js";
import { DEFAULT_PROVIDER_QUOTA_STALE_AFTER_MS } from "./isProviderQuotaStale.js";
import type { ProviderQuota } from "./providerQuota.js";

describe("createProviderQuotaCache", () => {
    it("reuses a captured quota until the default 15-minute staleness boundary", async () => {
        let now = 1_000_000;
        const load = vi.fn(
            async (): Promise<ProviderQuota> => ({
                status: "available",
                source: "codex",
                window: "five_hour",
                usedPercent: 20,
                resetsAt: 2_000_000,
                capturedAt: now,
            }),
        );
        const cache = createProviderQuotaCache(load, { now: () => now });

        const first = await cache.get();
        now += DEFAULT_PROVIDER_QUOTA_STALE_AFTER_MS - 1;
        expect(await cache.get()).toBe(first);
        expect(load).toHaveBeenCalledTimes(1);

        now += 1;
        await cache.get();
        expect(load).toHaveBeenCalledTimes(2);
    });

    it("deduplicates concurrent refreshes and supports explicit clearing", async () => {
        const resolvers: ((quota: ProviderQuota) => void)[] = [];
        const load = vi.fn(
            () =>
                new Promise<ProviderQuota>((resolve) => {
                    resolvers.push(resolve);
                }),
        );
        const cache = createProviderQuotaCache(load);

        const first = cache.get();
        const concurrent = cache.get();
        resolvers[0]?.({
            status: "unavailable",
            source: "claude-sdk",
            window: "five_hour",
            capturedAt: Date.now(),
        });

        expect(await first).toBe(await concurrent);
        expect(load).toHaveBeenCalledTimes(1);

        cache.clear();
        const refreshed = cache.get();
        expect(load).toHaveBeenCalledTimes(2);
        resolvers[1]?.({
            status: "unavailable",
            source: "claude-sdk",
            window: "five_hour",
            capturedAt: Date.now(),
        });
        await refreshed;
    });
});
