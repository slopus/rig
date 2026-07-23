import type { SDKAssistantMessageError, SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";

import type { SessionProviderError } from "@/core/SessionEvent.js";

export function classifyClaudeError(options: {
    assistantError?: SDKAssistantMessageError;
    message: string;
    rateLimitInfo?: SDKRateLimitInfo;
    requestId?: string;
}): SessionProviderError {
    const normalized = options.message.toLowerCase();
    const resetAt = earliestResetAt(options.rateLimitInfo);
    const outOfTokens =
        options.assistantError === "billing_error" ||
        options.rateLimitInfo?.overageDisabledReason === "out_of_credits" ||
        normalized.includes("credit balance is too low") ||
        normalized.includes("out of extra usage") ||
        normalized.includes("out of credits");
    if (outOfTokens) {
        return {
            type: "out_of_tokens",
            ...(resetAt === undefined ? {} : { resetAt }),
        };
    }

    const rateLimited =
        options.assistantError === "rate_limit" ||
        options.rateLimitInfo?.status === "rejected" ||
        normalized.includes("rate limit") ||
        normalized.includes("too many requests") ||
        /(?:session|weekly|opus|sonnet|usage) limit/iu.test(options.message) ||
        /(?:^|\D)429(?:\D|$)/u.test(options.message);
    if (rateLimited) {
        return {
            type: "rate_limit",
            ...(resetAt === undefined ? {} : { resetAt }),
        };
    }
    if (options.assistantError === "overloaded") return { type: "server_overloaded" };
    if (options.assistantError === "server_error") {
        return {
            type: "internal_server_error",
            ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
        };
    }
    return { type: "unclassified" };
}

function earliestResetAt(rateLimitInfo: SDKRateLimitInfo | undefined): number | undefined {
    const seconds = [rateLimitInfo?.resetsAt, rateLimitInfo?.overageResetsAt].filter(
        (value): value is number =>
            typeof value === "number" && Number.isFinite(value) && value >= 0,
    );
    return seconds.length === 0 ? undefined : Math.min(...seconds) * 1_000;
}
