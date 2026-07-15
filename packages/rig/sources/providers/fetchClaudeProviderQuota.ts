import {
    query as defaultClaudeSdkQuery,
    type Options as ClaudeSdkOptions,
    type Query,
    type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import { idleClaudeSdkPrompt } from "./idleClaudeSdkPrompt.js";
import type { ProviderQuota } from "./providerQuota.js";

export type ClaudeQuotaQuery = Pick<
    Query,
    "close" | "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET"
>;

export interface FetchClaudeProviderQuotaOptions {
    cwd?: string;
    now?: () => number;
    pathToClaudeCodeExecutable?: string;
    timeoutMs?: number;
    query?: (params: {
        prompt: AsyncIterable<SDKUserMessage>;
        options?: ClaudeSdkOptions;
    }) => ClaudeQuotaQuery;
}

export async function fetchClaudeProviderQuota(
    options: FetchClaudeProviderQuotaOptions = {},
): Promise<ProviderQuota> {
    const now = options.now ?? Date.now;
    const timeoutMs = options.timeoutMs ?? 5_000;
    const unavailable = (): ProviderQuota => ({
        status: "unavailable",
        source: "claude-sdk",
        window: "five_hour",
        capturedAt: now(),
    });

    const abortController = new AbortController();
    let sdkQuery: ClaudeQuotaQuery | undefined;
    try {
        sdkQuery = (options.query ?? defaultClaudeSdkQuery)({
            prompt: idleClaudeSdkPrompt(abortController.signal),
            options: {
                abortController,
                ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
                ...(options.pathToClaudeCodeExecutable !== undefined
                    ? { pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable }
                    : {}),
                persistSession: false,
            },
        });
        const usageRequest = sdkQuery.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
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
        const fiveHour = usage.rate_limits?.five_hour;
        if (
            !usage.rate_limits_available ||
            fiveHour == null ||
            typeof fiveHour.utilization !== "number" ||
            !Number.isFinite(fiveHour.utilization) ||
            fiveHour.utilization < 0 ||
            fiveHour.utilization > 100 ||
            typeof fiveHour.resets_at !== "string"
        ) {
            return unavailable();
        }

        const resetsAt = Date.parse(fiveHour.resets_at);
        if (!Number.isFinite(resetsAt)) {
            return unavailable();
        }

        return {
            status: "available",
            source: "claude-sdk",
            window: "five_hour",
            usedPercent: fiveHour.utilization,
            resetsAt,
            capturedAt: now(),
        };
    } catch {
        return unavailable();
    } finally {
        abortController.abort();
        try {
            sdkQuery?.close();
        } catch {
            // Cleanup errors do not make an otherwise authoritative response unavailable.
        }
    }
}
