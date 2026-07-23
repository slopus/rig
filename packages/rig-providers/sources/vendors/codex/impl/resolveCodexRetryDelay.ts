import { readCodexErrorHeader } from "@/vendors/codex/impl/readCodexErrorHeader.js";

const MAX_SERVER_RETRY_DELAY_MS = 60_000;

export function resolveCodexRetryDelay(
    attempt: number,
    error: unknown,
    random: () => number = Math.random,
): number {
    const milliseconds = parseFiniteNumber(readCodexErrorHeader(error, "retry-after-ms"));
    if (
        milliseconds !== undefined &&
        milliseconds >= 0 &&
        milliseconds <= MAX_SERVER_RETRY_DELAY_MS
    )
        return milliseconds;
    const retryAfter = readCodexErrorHeader(error, "retry-after");
    const seconds = parseFiniteNumber(retryAfter);
    if (seconds !== undefined && seconds >= 0 && seconds * 1_000 <= MAX_SERVER_RETRY_DELAY_MS)
        return seconds * 1_000;
    if (retryAfter !== undefined) {
        const dateDelay = Date.parse(retryAfter) - Date.now();
        if (dateDelay >= 0 && dateDelay <= MAX_SERVER_RETRY_DELAY_MS) return dateDelay;
    }
    const base = 200 * 2 ** Math.max(0, attempt - 1);
    return Math.floor(base * (0.9 + random() * 0.2));
}

function parseFiniteNumber(value: string | undefined): number | undefined {
    if (value === undefined || value.trim() === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
