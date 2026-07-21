import { describe, expect, it, vi } from "vitest";

import {
    createProviderQuotaService,
    type CreateProviderQuotaServiceOptions,
} from "./createProviderQuotaService.js";
import type { ProviderQuota, ProviderQuotaSource } from "./providerQuota.js";

describe("createProviderQuotaService", () => {
    it("keeps independent provider caches and exposes both account windows", async () => {
        let now = 1_000;
        const loadCodexQuota = vi.fn(async () => quota("codex", now, 30, 10));
        const loadClaudeQuota = vi.fn(async () => quota("claude", now, 40, 20));
        const loadKimiQuota = vi.fn(async () => quota("kimi", now, 7, 14));
        const service = createProviderQuotaService({
            cwd: "/tmp/quota-service",
            loadClaudeQuota,
            loadCodexQuota,
            loadKimiQuota,
            now: () => now,
        });

        await expect(service.get("codex")).resolves.toMatchObject({
            windows: {
                fiveHour: { usedPercent: 30 },
                weekly: { usedPercent: 10 },
            },
        });
        await expect(service.get("claude")).resolves.toMatchObject({
            windows: {
                fiveHour: { usedPercent: 40 },
                weekly: { usedPercent: 20 },
            },
        });
        await expect(service.get("kimi")).resolves.toMatchObject({
            windows: {
                fiveHour: { usedPercent: 7 },
                weekly: { usedPercent: 14 },
            },
        });
        now += 1;
        await service.get("codex");
        await service.get("claude", { fresh: true });
        await service.get("kimi", { fresh: true });

        expect(loadCodexQuota).toHaveBeenCalledOnce();
        expect(loadClaudeQuota).toHaveBeenCalledTimes(2);
        expect(loadKimiQuota).toHaveBeenCalledTimes(2);
        await expect(service.get("gym")).resolves.toBeUndefined();
    });

    it("loads Claude quota for a named provider configured with the Claude type", async () => {
        const loadClaudeQuota = vi.fn(async () => quota("claude", 1_000, 40, 20));
        const service = createProviderQuotaService({
            cwd: "/tmp/quota-service",
            loadClaudeQuota,
            providers: {
                kirill_claude: {
                    enabled: true,
                    oauthToken: "named-claude-token",
                    type: "claude",
                },
            },
        });

        await expect(service.get("kirill_claude")).resolves.toMatchObject({
            source: "claude",
            windows: {
                fiveHour: { usedPercent: 40 },
                weekly: { usedPercent: 20 },
            },
        });
        expect(loadClaudeQuota).toHaveBeenCalledOnce();
    });

    it("scopes a named Claude quota probe to that provider's credentials", async () => {
        const close = vi.fn();
        const createClaudeQuery = vi.fn<
            NonNullable<CreateProviderQuotaServiceOptions["createClaudeQuery"]>
        >(
            () =>
                ({
                    close,
                    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: vi
                        .fn()
                        .mockResolvedValue({
                            rate_limits_available: true,
                            rate_limits: {
                                five_hour: {
                                    resets_at: "2026-07-21T01:00:00.000Z",
                                    utilization: 40,
                                },
                                seven_day: {
                                    resets_at: "2026-07-27T01:00:00.000Z",
                                    utilization: 20,
                                },
                            },
                        }),
                }) as never,
        );
        const service = createProviderQuotaService({
            createClaudeQuery,
            cwd: "/tmp/quota-service",
            env: {
                ANTHROPIC_API_KEY: "default-api-key",
                CLAUDE_CODE_OAUTH_TOKEN: "default-oauth-token",
            },
            providers: {
                kirill_claude: {
                    configDir: "/tmp/kirill-claude",
                    enabled: true,
                    executable: "/tmp/claude",
                    oauthToken: "named-claude-token",
                    type: "claude",
                },
            },
        });

        await expect(service.get("kirill_claude")).resolves.toMatchObject({
            source: "claude",
            windows: {
                fiveHour: { usedPercent: 40 },
                weekly: { usedPercent: 20 },
            },
        });
        expect(createClaudeQuery).toHaveBeenCalledOnce();
        const queryOptions = createClaudeQuery.mock.calls[0]?.[0]?.options;
        expect(queryOptions?.env).toMatchObject({
            CLAUDE_CODE_OAUTH_TOKEN: "named-claude-token",
            CLAUDE_CONFIG_DIR: "/tmp/kirill-claude",
        });
        expect(queryOptions?.env).not.toHaveProperty("ANTHROPIC_API_KEY");
        expect(queryOptions?.pathToClaudeCodeExecutable).toBe("/tmp/claude");
        expect(close).toHaveBeenCalledOnce();
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
                capturedAt,
                resetsAt: 10_000,
                status: "available",
                usedPercent: fiveHourUsed,
            },
            weekly: {
                capturedAt,
                resetsAt: 20_000,
                status: "available",
                usedPercent: weeklyUsed,
            },
        },
    };
}
