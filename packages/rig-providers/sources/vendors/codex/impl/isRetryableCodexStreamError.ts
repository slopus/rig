import { readCodexErrorHeader } from "@/vendors/codex/impl/readCodexErrorHeader.js";

export function isRetryableCodexStreamError(error: unknown): boolean {
    if (hasAbortError(error, new Set())) return false;
    return isRetryable(error, new Set());
}

function isRetryable(error: unknown, seen: Set<object>): boolean {
    const directive = readCodexErrorHeader(error, "x-should-retry")?.trim().toLowerCase();
    if (directive === "true") return true;
    if (directive === "false") return false;
    if (typeof error === "object" && error !== null) {
        if (seen.has(error)) return false;
        seen.add(error);
    }
    const status = numericProperty(error, "status");
    if (status !== undefined)
        return status === 408 || status === 409 || status === 429 || status >= 500;
    const code = stringProperty(error, "code") ?? stringProperty(error, "errno");
    if (code !== undefined && RETRYABLE_CODES.has(code.toUpperCase())) return true;
    const name = stringProperty(error, "name");
    if (name !== undefined && RETRYABLE_NAMES.has(name)) return true;
    const message = error instanceof Error ? error.message : "";
    if (RETRYABLE_MESSAGE.test(message)) return true;
    const cause =
        typeof error === "object" && error !== null && "cause" in error
            ? (error as { cause?: unknown }).cause
            : undefined;
    return cause !== undefined && isRetryable(cause, seen);
}

function hasAbortError(error: unknown, seen: Set<object>): boolean {
    if (isAbortError(error)) return true;
    if (typeof error !== "object" || error === null || seen.has(error)) return false;
    seen.add(error);
    return "cause" in error && hasAbortError((error as { cause?: unknown }).cause, seen);
}

const RETRYABLE_CODES = new Set([
    "ECONNABORTED",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETDOWN",
    "ENETUNREACH",
    "ENOTFOUND",
    "EPIPE",
    "ETIMEDOUT",
]);

const RETRYABLE_NAMES = new Set([
    "APIConnectionError",
    "APIConnectionTimeoutError",
    "TimeoutError",
    "WebSocketError",
]);

const RETRYABLE_MESSAGE =
    /\b(connection (?:closed|dropped|failed|lost|reset)|fetch failed|network error|socket (?:closed|disconnected|error|hang up)|stream (?:closed|disconnected)|timed? out|websocket (?:closed|disconnected|error))\b/i;

function isAbortError(error: unknown): boolean {
    return (
        (error instanceof DOMException && error.name === "AbortError") ||
        stringProperty(error, "name") === "AbortError"
    );
}

function numericProperty(error: unknown, property: string): number | undefined {
    if (typeof error !== "object" || error === null || !(property in error)) return undefined;
    const value = (error as Record<string, unknown>)[property];
    return typeof value === "number" ? value : undefined;
}

function stringProperty(error: unknown, property: string): string | undefined {
    if (typeof error !== "object" || error === null || !(property in error)) return undefined;
    const value = (error as Record<string, unknown>)[property];
    return typeof value === "string" ? value : undefined;
}
