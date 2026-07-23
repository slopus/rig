import type { ResponseUsage } from "openai/resources/responses/responses.js";

import type { SessionCacheUsage } from "@/core/SessionCacheUsage.js";

export function toSessionCacheUsage(usage: ResponseUsage | undefined): SessionCacheUsage {
    const cachedTokens = usage?.input_tokens_details?.cached_tokens ?? 0;
    const cacheWriteTokens = usage?.input_tokens_details?.cache_write_tokens ?? 0;
    const input = Math.max(0, (usage?.input_tokens ?? 0) - cachedTokens - cacheWriteTokens);
    const output = usage?.output_tokens ?? 0;
    return {
        input,
        output,
        cacheRead: cachedTokens,
        cacheWrite: cacheWriteTokens,
        totalTokens: usage?.total_tokens ?? input + output + cachedTokens + cacheWriteTokens,
    };
}
