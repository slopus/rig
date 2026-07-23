import type { ProviderError } from "@slopus/rig-execution";
import { formatResetDuration } from "./formatResetDuration.js";
import { humanizeProviderId } from "./humanizeProviderId.js";

export function formatProviderError(
    error: ProviderError | undefined,
    options: { fallbackMessage?: string; now?: number; providerId: string },
): string {
    const provider = humanizeProviderId(options.providerId);
    const resetAt = error !== undefined && "resetAt" in error ? error.resetAt : undefined;
    const reset =
        resetAt === undefined
            ? undefined
            : formatResetDuration(resetAt - (options.now ?? Date.now()));

    if (error?.type === "out_of_tokens") {
        return `${provider} is out of tokens.${reset === undefined ? "" : ` Resets in ${reset}.`}`;
    }
    if (error?.type === "rate_limit") {
        return `${provider} is rate limited.${reset === undefined ? "" : ` Try again in ${reset}.`}`;
    }
    if (error?.type === "server_overloaded") {
        return `${provider} servers are overloaded. Try again later.`;
    }
    if (error?.type === "internal_server_error") {
        return `${provider} encountered an internal server error. Try again.${error.requestId === undefined ? "" : ` Request ID: ${error.requestId}.`}`;
    }
    return options.fallbackMessage?.trim() || `${provider} returned an error.`;
}
