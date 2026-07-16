export function createRetryableMemo<T>(load: () => Promise<T>): () => Promise<T> {
    let memoized: Promise<T> | undefined;

    return () => {
        if (memoized === undefined) {
            const attempt = Promise.resolve()
                .then(load)
                .catch((error: unknown) => {
                    if (memoized === attempt) memoized = undefined;
                    throw error;
                });
            memoized = attempt;
        }
        return memoized;
    };
}
