const DEFAULT_CODEX_STREAM_IDLE_TIMEOUT_MS = 300_000;

export function resolveCodexStreamIdleTimeout(value?: number): number {
    if (value === undefined) return DEFAULT_CODEX_STREAM_IDLE_TIMEOUT_MS;
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
        throw new TypeError("streamIdleTimeoutMs must be a finite positive integer.");
    }
    return value;
}
