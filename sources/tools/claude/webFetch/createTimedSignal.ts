export interface TimedSignal {
    signal: AbortSignal;
    dispose(): void;
}

export function createTimedSignal(parent: AbortSignal | undefined, timeoutMs: number): TimedSignal {
    const controller = new AbortController();
    const onAbort = () => controller.abort(parent?.reason);
    if (parent?.aborted) {
        onAbort();
    } else {
        parent?.addEventListener("abort", onAbort, { once: true });
    }

    const timeout = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);
    return {
        signal: controller.signal,
        dispose() {
            clearTimeout(timeout);
            parent?.removeEventListener("abort", onAbort);
        },
    };
}
