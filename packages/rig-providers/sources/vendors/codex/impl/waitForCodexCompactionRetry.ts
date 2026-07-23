const BASE_DELAY_MS = 200;
const JITTER_FRACTION = 0.1;

export function waitForCodexCompactionRetry(attempt: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted)
        return Promise.reject(new DOMException("Request was aborted", "AbortError"));
    const base = BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1);
    const jitter = 1 + (Math.random() * 2 - 1) * JITTER_FRACTION;
    const delay = Math.round(base * jitter);
    return new Promise((resolve, reject) => {
        const finish = (): void => {
            signal?.removeEventListener("abort", abort);
            resolve();
        };
        const timeout = setTimeout(finish, delay);
        const abort = (): void => {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", abort);
            reject(new DOMException("Request was aborted", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal !== undefined) {
            void Promise.resolve().then(() => {
                if (!signal.aborted) return;
                abort();
            });
        }
    });
}
