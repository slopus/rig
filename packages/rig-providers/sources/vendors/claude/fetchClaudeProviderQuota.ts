import type { Query } from "@anthropic-ai/claude-agent-sdk";

import type { ProviderQuota, ProviderQuotaWindow } from "@/core/ProviderQuota.js";
import { unavailableProviderQuota } from "@/core/unavailableProviderQuota.js";

export type ClaudeQuotaQuery = Pick<
    Query,
    "close" | "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET"
>;

export interface FetchClaudeProviderQuotaOptions {
    now?: () => number;
    timeoutMs?: number;
}

export async function fetchClaudeProviderQuota(
    query: ClaudeQuotaQuery,
    options: FetchClaudeProviderQuotaOptions = {},
): Promise<ProviderQuota> {
    const now = options.now ?? Date.now;
    const timeoutMs = options.timeoutMs ?? 5_000;
    const unavailable = (): ProviderQuota => unavailableProviderQuota("claude", now());

    try {
        const usageRequest = query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const timeoutRequest = new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
                () => reject(new Error("Claude usage request timed out.")),
                timeoutMs,
            );
        });
        const usage = await Promise.race([usageRequest, timeoutRequest]).finally(() => {
            if (timeout !== undefined) clearTimeout(timeout);
        });
        if (!usage.rate_limits_available) return unavailable();
        const capturedAt = now();
        return {
            capturedAt,
            source: "claude",
            windows: {
                fiveHour: parseClaudeQuotaWindow(usage.rate_limits?.five_hour, capturedAt),
                weekly: parseClaudeQuotaWindow(usage.rate_limits?.seven_day, capturedAt),
            },
        };
    } catch {
        return unavailable();
    } finally {
        try {
            query.close();
        } catch {
            // Cleanup errors do not make an otherwise authoritative response unavailable.
        }
    }
}

function parseClaudeQuotaWindow(
    window: { utilization: number | null; resets_at: string | null } | null | undefined,
    capturedAt: number,
): ProviderQuotaWindow {
    if (
        typeof window?.utilization !== "number" ||
        !Number.isFinite(window.utilization) ||
        window.utilization < 0 ||
        window.utilization > 100 ||
        typeof window.resets_at !== "string"
    ) {
        return { status: "unavailable" };
    }
    const resetsAt = Date.parse(window.resets_at);
    return Number.isFinite(resetsAt)
        ? { capturedAt, status: "available", usedPercent: window.utilization, resetsAt }
        : { status: "unavailable" };
}
