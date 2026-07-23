import { isGrokContextOverflowError } from "@/vendors/grok/impl/classifyGrokError.js";

export function isRetryableGrokCompactionError(message: string): boolean {
    const normalized = message.toLowerCase();
    if (
        isGrokContextOverflowError(message) ||
        normalized.includes("invalid_request_error") ||
        normalized.includes("authentication failed") ||
        normalized.includes("invalid client configuration") ||
        normalized.includes("invalid configuration") ||
        normalized.includes("serialization error") ||
        normalized.includes("failed to parse api response") ||
        normalized.includes("inference idle timeout") ||
        normalized.includes("model stopped responding") ||
        normalized.includes("response truncated by max_tokens")
    ) {
        return false;
    }

    const status = message.match(/(?:^|\D)(\d{3})(?:\D|$)/u)?.[1];
    if (status === undefined) return true;
    const code = Number(status);
    return code === 408 || code === 429 || code >= 500;
}
