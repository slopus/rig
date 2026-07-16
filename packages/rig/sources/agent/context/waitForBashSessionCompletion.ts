export function waitForBashSessionCompletion(
    waiters: Set<() => void>,
    waitMs: number,
    signal?: AbortSignal,
): Promise<void> {
    return new Promise((resolve) => {
        let settled = false;
        let timer: NodeJS.Timeout | undefined;
        const finish = () => {
            if (settled) return;
            settled = true;
            waiters.delete(finish);
            if (timer !== undefined) clearTimeout(timer);
            signal?.removeEventListener("abort", finish);
            resolve();
        };
        waiters.add(finish);
        timer = setTimeout(finish, waitMs);
        signal?.addEventListener("abort", finish, { once: true });
        if (signal?.aborted) finish();
    });
}
