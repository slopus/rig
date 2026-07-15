import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";

import {
    fetchClaudeProviderQuota,
    type ClaudeQuotaQuery,
    type FetchClaudeProviderQuotaOptions,
} from "./fetchClaudeProviderQuota.js";

describe("fetchClaudeProviderQuota", () => {
    it("opens a streaming control session and closes it after reading usage", async () => {
        const close = vi.fn();
        const query = vi.fn<NonNullable<FetchClaudeProviderQuotaOptions["query"]>>(() => ({
            close,
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: vi.fn().mockResolvedValue({
                session: emptySessionUsage(),
                subscription_type: "pro",
                rate_limits_available: false,
                rate_limits: null,
            }),
        }));

        await fetchClaudeProviderQuota({
            cwd: "/workspace",
            pathToClaudeCodeExecutable: "/usr/local/bin/claude",
            query,
        });

        expect(query).toHaveBeenCalledOnce();
        const request = query.mock.calls[0]?.[0];
        expect(request?.prompt[Symbol.asyncIterator]).toBeTypeOf("function");
        expect(request?.options).toMatchObject({
            cwd: "/workspace",
            pathToClaudeCodeExecutable: "/usr/local/bin/claude",
            persistSession: false,
        });
        expect(request?.options?.abortController?.signal.aborted).toBe(true);
        expect(close).toHaveBeenCalledOnce();
    });

    it("maps the SDK five-hour plan window without estimating", async () => {
        const query = usageQuery({
            rate_limits_available: true,
            rate_limits: {
                five_hour: {
                    utilization: 62.25,
                    resets_at: "2026-05-01T12:00:00.000Z",
                },
            },
        });

        await expect(fetchClaudeProviderQuota({ query, now: () => 500 })).resolves.toEqual({
            status: "available",
            source: "claude-sdk",
            window: "five_hour",
            usedPercent: 62.25,
            resetsAt: Date.parse("2026-05-01T12:00:00.000Z"),
            capturedAt: 500,
        });
    });

    it.each([
        {
            name: "rate limits explicitly unavailable",
            response: { rate_limits_available: false, rate_limits: null },
        },
        {
            name: "a null rate-limit payload",
            response: { rate_limits_available: true, rate_limits: null },
        },
        {
            name: "a null five-hour window",
            response: { rate_limits_available: true, rate_limits: { five_hour: null } },
        },
        {
            name: "incomplete five-hour data",
            response: {
                rate_limits_available: true,
                rate_limits: { five_hour: { utilization: null, resets_at: null } },
            },
        },
    ])("returns unavailable for $name", async ({ response }) => {
        await expect(
            fetchClaudeProviderQuota({ query: usageQuery(response), now: () => 600 }),
        ).resolves.toEqual({
            status: "unavailable",
            source: "claude-sdk",
            window: "five_hour",
            capturedAt: 600,
        });
    });

    it("returns unavailable when the SDK control request fails", async () => {
        const query = (): ClaudeQuotaQuery => ({
            close: vi.fn(),
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: vi
                .fn()
                .mockRejectedValue(new Error("control request failed")),
        });

        await expect(fetchClaudeProviderQuota({ query, now: () => 700 })).resolves.toEqual({
            status: "unavailable",
            source: "claude-sdk",
            window: "five_hour",
            capturedAt: 700,
        });
    });

    it("times out the SDK control request and closes the query", async () => {
        const close = vi.fn();
        const query = (): ClaudeQuotaQuery => ({
            close,
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () =>
                new Promise<never>(() => {}),
        });

        await expect(
            fetchClaudeProviderQuota({ query, now: () => 800, timeoutMs: 1 }),
        ).resolves.toMatchObject({ capturedAt: 800, status: "unavailable" });
        expect(close).toHaveBeenCalledOnce();
    });
});

function usageQuery(
    response: Pick<SDKControlGetUsageResponse, "rate_limits_available" | "rate_limits">,
): NonNullable<FetchClaudeProviderQuotaOptions["query"]> {
    return () => ({
        close: vi.fn(),
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: vi.fn().mockResolvedValue({
            session: emptySessionUsage(),
            subscription_type: null,
            ...response,
        }),
    });
}

function emptySessionUsage(): SDKControlGetUsageResponse["session"] {
    return {
        total_cost_usd: 0,
        total_api_duration_ms: 0,
        total_duration_ms: 0,
        total_lines_added: 0,
        total_lines_removed: 0,
        model_usage: {},
    };
}
