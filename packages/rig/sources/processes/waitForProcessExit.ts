import { setTimeout as delay } from "node:timers/promises";

import { isProcessRunning } from "./isProcessRunning.js";

const POLL_INTERVAL_MS = 50;

export async function waitForProcessExit(processId: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (await isProcessRunning(processId)) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) return false;
        await delay(Math.min(POLL_INTERVAL_MS, remainingMs));
    }
    return true;
}
