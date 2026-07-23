export async function* withCodexStreamIdleTimeout<T>(options: {
    stream: AsyncIterable<T>;
    timeoutMs: number;
    signal?: AbortSignal;
    onTimeout?: () => void;
}): AsyncGenerator<T> {
    const iterator = options.stream[Symbol.asyncIterator]();
    try {
        for (;;) {
            if (options.signal?.aborted)
                throw new DOMException("Request was aborted", "AbortError");
            let timeout: ReturnType<typeof setTimeout> | undefined;
            const idle = new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(() => {
                    options.onTimeout?.();
                    const error = new Error(
                        `Codex stream timed out after ${options.timeoutMs}ms without activity.`,
                    );
                    error.name = "TimeoutError";
                    reject(error);
                }, options.timeoutMs);
            });
            try {
                const item = await Promise.race([iterator.next(), idle]);
                if (item.done) return;
                yield item.value;
            } finally {
                if (timeout !== undefined) clearTimeout(timeout);
            }
        }
    } finally {
        void iterator.return?.();
    }
}
