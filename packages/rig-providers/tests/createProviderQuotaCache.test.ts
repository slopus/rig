import { describe, expect, it, vi } from "vitest";

import {
    createProviderQuotaCache,
    DEFAULT_PROVIDER_QUOTA_STALE_AFTER_MS,
    type ProviderQuota,
} from "@/index.js";

describe("createProviderQuotaCache", () => {
    it("reuses a captured quota until the default 15-minute staleness boundary", async () => {
        let now = 1_000_000;
        const load = vi.fn(
            async (): Promise<ProviderQuota> => ({
                capturedAt: now,
                source: "codex",
                windows: {
                    fiveHour: {
                        capturedAt: 1,
                        status: "available",
                        usedPercent: 20,
                        resetsAt: 2_000_000,
                    },
                    weekly: { status: "unavailable" },
                },
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
            capturedAt: Date.now(),
            source: "claude",
            windows: {
                fiveHour: { status: "unavailable" },
                weekly: { status: "unavailable" },
            },
        });

        expect(await first).toBe(await concurrent);
        expect(load).toHaveBeenCalledTimes(1);

        cache.clear();
        const refreshed = cache.get();
        expect(load).toHaveBeenCalledTimes(2);
        resolvers[1]?.({
            capturedAt: Date.now(),
            source: "claude",
            windows: {
                fiveHour: { status: "unavailable" },
                weekly: { status: "unavailable" },
            },
        });
        await refreshed;
    });

    it("refreshes explicitly while retaining the new snapshot for ordinary reads", async () => {
        let now = 1_000;
        const load = vi.fn(
            async (): Promise<ProviderQuota> => ({
                capturedAt: now,
                source: "codex",
                windows: {
                    fiveHour: {
                        capturedAt: 2,
                        status: "available",
                        usedPercent: load.mock.calls.length,
                        resetsAt: 9_000,
                    },
                    weekly: { status: "unavailable" },
                },
            }),
        );
        const cache = createProviderQuotaCache(load, { now: () => now });

        await cache.get();
        now = 2_000;
        const refreshed = await cache.get({ fresh: true });

        expect(load).toHaveBeenCalledTimes(2);
        expect(refreshed.capturedAt).toBe(2_000);
        expect(await cache.get()).toBe(refreshed);
    });

    it("refreshes as soon as any available quota window has reset", async () => {
        let now = 1_000;
        const load = vi.fn(
            async (): Promise<ProviderQuota> => ({
                capturedAt: now,
                source: "codex",
                windows: {
                    fiveHour: {
                        capturedAt: now,
                        resetsAt: 2_000,
                        status: "available",
                        usedPercent: 20,
                    },
                    weekly: {
                        capturedAt: now,
                        resetsAt: 20_000,
                        status: "available",
                        usedPercent: 10,
                    },
                },
            }),
        );
        const cache = createProviderQuotaCache(load, { now: () => now });

        await cache.get();
        now = 1_999;
        await cache.get();
        expect(load).toHaveBeenCalledTimes(1);

        now = 2_000;
        await cache.get();
        expect(load).toHaveBeenCalledTimes(2);
    });
});
