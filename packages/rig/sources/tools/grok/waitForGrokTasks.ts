import type { AgentContext } from "../../agent/index.js";
import { readGrokTask, type GrokTaskResult } from "./read_grok_task.js";

export async function waitForGrokTasks(options: {
    context: AgentContext;
    mode: "wait_any" | "wait_all";
    signal?: AbortSignal;
    taskIds: readonly string[];
    timeoutMs: number;
}): Promise<GrokTaskResult[]> {
    const deadline = Date.now() + Math.max(0, options.timeoutMs);
    let results = await Promise.all(
        options.taskIds.map((taskId) =>
            readGrokTask({ context: options.context, taskId, timeoutMs: 0 }),
        ),
    );
    if (results.length === 0) return results;

    const isSatisfied = () =>
        options.mode === "wait_any"
            ? results.some((result) => result.status !== "running")
            : results.every((result) => result.status !== "running");
    while (!isSatisfied() && Date.now() < deadline) {
        await new Promise<void>((resolve, reject) => {
            const onAbort = () => {
                clearTimeout(timer);
                options.signal?.removeEventListener("abort", onAbort);
                reject(new Error("Waiting for background tasks was cancelled."));
            };
            const timer = setTimeout(
                () => {
                    options.signal?.removeEventListener("abort", onAbort);
                    resolve();
                },
                Math.min(50, deadline - Date.now()),
            );
            options.signal?.addEventListener("abort", onAbort, { once: true });
            if (options.signal?.aborted) onAbort();
        });
        results = await Promise.all(
            options.taskIds.map((taskId) =>
                readGrokTask({ context: options.context, taskId, timeoutMs: 0 }),
            ),
        );
    }
    return results;
}
