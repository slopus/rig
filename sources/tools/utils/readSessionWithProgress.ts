import type { BashContext, BashSessionSnapshot } from "../../agent/index.js";

const PROGRESS_POLL_MS = 100;

export async function readSessionWithProgress(options: {
    bash: BashContext;
    onProgress?: (display: string) => void;
    sessionId: number;
    signal?: AbortSignal;
    waitMs?: number;
}): Promise<BashSessionSnapshot | undefined> {
    const deadline = options.waitMs === undefined ? undefined : Date.now() + options.waitMs;
    let stderrDelta = "";
    let stdoutDelta = "";
    let snapshot: BashSessionSnapshot | undefined;

    do {
        const remaining =
            deadline === undefined ? PROGRESS_POLL_MS : Math.max(0, deadline - Date.now());
        snapshot = await options.bash.readSession(options.sessionId, {
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            waitMs: Math.min(PROGRESS_POLL_MS, remaining),
        });
        if (snapshot === undefined) return undefined;
        stdoutDelta += snapshot.stdoutDelta;
        stderrDelta += snapshot.stderrDelta;
        const progress = [stdoutDelta, stderrDelta].filter(Boolean).join("\n");
        if (progress.length > 0) options.onProgress?.(progress.slice(-2_000));
        if (
            snapshot.status !== "running" ||
            options.signal?.aborted ||
            (deadline !== undefined && remaining === 0)
        ) {
            break;
        }
    } while (deadline === undefined || Date.now() < deadline);

    return snapshot === undefined ? undefined : { ...snapshot, stderrDelta, stdoutDelta };
}
