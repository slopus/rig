/** Detects a server rejection that can be retried with a smaller compaction input. */
export function isCodexContextWindowError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /context window|context length|maximum context|too many tokens/iu.test(message);
}
