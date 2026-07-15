import { INFERENCE_RETRY_INITIAL_DELAY_MS } from "./inferenceRetryPolicy.js";

export async function delayBeforeInferenceRetry(
    attempt: number,
    signal: AbortSignal | undefined,
): Promise<void> {
    const baseDelayMs = INFERENCE_RETRY_INITIAL_DELAY_MS * 2 ** (attempt - 1);
    const delayMs = baseDelayMs * (0.9 + Math.random() * 0.2);
    await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timeout);
            reject(signal?.reason ?? new Error("Inference retry aborted."));
        };
        const timeout = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, delayMs);
        if (signal === undefined) return;
        if (signal.aborted) {
            onAbort();
            return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
    });
}
