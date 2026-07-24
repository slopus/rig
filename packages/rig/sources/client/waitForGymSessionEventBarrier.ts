import { access, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { SessionEvent } from "../protocol/index.js";

export async function waitForGymSessionEventBarrier(
    event: SessionEvent,
    signal: AbortSignal | undefined,
): Promise<void> {
    const configuredPath = process.env.RIG_GYM_SESSION_TERMINAL_EVENT_BARRIER?.trim();
    if (
        configuredPath === undefined ||
        configuredPath.length === 0 ||
        (event.type !== "run_finished" && event.type !== "run_error")
    ) {
        return;
    }

    const releasePath = resolve(configuredPath);
    try {
        await access(releasePath);
        return;
    } catch (error) {
        if (!isMissingFile(error)) throw error;
    }

    await appendFile(`${releasePath}.ready`, "1");
    for (;;) {
        signal?.throwIfAborted();
        try {
            await access(releasePath);
            return;
        } catch (error) {
            if (!isMissingFile(error)) throw error;
        }
        await delay(10, undefined, signal === undefined ? undefined : { signal });
    }
}

function isMissingFile(error: unknown): boolean {
    return (
        typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
    );
}
