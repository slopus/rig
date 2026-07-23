const DEFAULT_CODEX_STREAM_MAX_RETRIES = 5;
const MAX_CODEX_STREAM_MAX_RETRIES = 100;

export function resolveCodexStreamMaxRetries(value?: number): number {
    if (value === undefined) return DEFAULT_CODEX_STREAM_MAX_RETRIES;
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
        throw new TypeError("streamMaxRetries must be a finite nonnegative integer.");
    }
    return Math.min(value, MAX_CODEX_STREAM_MAX_RETRIES);
}
