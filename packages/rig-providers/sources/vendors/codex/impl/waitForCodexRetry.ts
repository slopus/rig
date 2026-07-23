import { resolveCodexRetryDelay } from "@/vendors/codex/impl/resolveCodexRetryDelay.js";

export function waitForCodexRetry(
    attempt: number,
    error: unknown,
    signal?: AbortSignal,
): Promise<void> {
    if (signal?.aborted)
        return Promise.reject(new DOMException("Request was aborted", "AbortError"));
    const delay = resolveCodexRetryDelay(attempt, error);
    return new Promise((resolve, reject) => {
        const abort = (): void => {
            clearTimeout(timeout);
            reject(new DOMException("Request was aborted", "AbortError"));
        };
        const timeout = setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
        }, delay);
        signal?.addEventListener("abort", abort, { once: true });
    });
}
