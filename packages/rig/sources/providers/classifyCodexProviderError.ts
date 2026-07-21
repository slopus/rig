import type { ProviderError } from "./types.js";

export function classifyCodexProviderError(message: string): ProviderError {
    const normalized = message.toLowerCase();

    if (
        normalized.includes("server_is_overloaded") ||
        /\bservers?(?: (?:are|is))? (?:currently )?overloaded\b/iu.test(message)
    ) {
        return { type: "server_overloaded" };
    }

    if (
        normalized.includes("internal_server_error") ||
        normalized.includes("an error occurred while processing your request")
    ) {
        const requestId = message.match(/\brequest id\s+([a-z0-9][a-z0-9_-]*)/iu)?.[1];
        return {
            type: "internal_server_error",
            ...(requestId === undefined ? {} : { requestId }),
        };
    }

    return { type: "unclassified" };
}
