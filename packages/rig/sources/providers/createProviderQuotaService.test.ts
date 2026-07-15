import { describe, expect, it, vi } from "vitest";

import { createProviderQuotaService } from "./createProviderQuotaService.js";
import type { ProviderQuota, ProviderQuotaSource } from "./providerQuota.js";

describe("createProviderQuotaService", () => {
    it("keeps independent provider caches and exposes both account windows", async () => {
        let now = 1_000;
        const loadCodexQuota = vi.fn(async () => quota("codex", now, 30, 10));
        const loadClaudeQuota = vi.fn(async () => quota("claude-sdk", now, 40, 20));
        const service = createProviderQuotaService({
            cwd: "/tmp/quota-service",
            loadClaudeQuota,
            loadCodexQuota,
            now: () => now,
        });

        await expect(service.get("codex")).resolves.toMatchObject({
            windows: {
                fiveHour: { usedPercent: 30 },
                weekly: { usedPercent: 10 },
            },
        });
        await expect(service.get("claude-sdk")).resolves.toMatchObject({
            windows: {
                fiveHour: { usedPercent: 40 },
                weekly: { usedPercent: 20 },
            },
        });
        now += 1;
        await service.get("codex");
        await service.get("claude-sdk", { fresh: true });

        expect(loadCodexQuota).toHaveBeenCalledOnce();
        expect(loadClaudeQuota).toHaveBeenCalledTimes(2);
        await expect(service.get("gym")).resolves.toBeUndefined();
    });
});

function quota(
    source: ProviderQuotaSource,
    capturedAt: number,
    fiveHourUsed: number,
    weeklyUsed: number,
): ProviderQuota {
    return {
        capturedAt,
        source,
        windows: {
            fiveHour: {
                resetsAt: 10_000,
                status: "available",
                usedPercent: fiveHourUsed,
            },
            weekly: {
                resetsAt: 20_000,
                status: "available",
                usedPercent: weeklyUsed,
            },
        },
    };
}
