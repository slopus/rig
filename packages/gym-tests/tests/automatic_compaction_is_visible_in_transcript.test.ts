import { mkdir } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";

import {
    createGym,
    renderTerminalSnapshotPng,
    type Gym,
    type TerminalSnapshot,
} from "@slopus/rig-gym";

const running = new Set<Gym>();
const usageArtifacts = resolve(import.meta.dirname, "../../artifacts/session-usage");

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("automatic conversation compaction", () => {
    it("shows a durable transcript row when a small context window triggers compaction", async () => {
        const firstResponseStarted = deferred<void>();
        const releaseFirstResponse = deferred<void>();
        const gym = await createGym({
            cols: 92,
            contextWindow: 500,
            async inference(request, callIndex) {
                const isCompaction = request.context.systemPrompt?.startsWith(
                    "Create a detailed continuation brief",
                );
                if (callIndex === 0) {
                    firstResponseStarted.resolve();
                    await releaseFirstResponse.promise;
                    return {
                        content: [
                            {
                                text: `Loaded a large working context.\n\n${"context detail ".repeat(180)}`,
                                type: "text",
                            },
                        ],
                        usage: usage(400, 50),
                    };
                }
                if (callIndex === 1) {
                    expect(isCompaction).toBe(true);
                    return {
                        content: [{ text: "The earlier context was summarized.", type: "text" }],
                    };
                }
                expect(callIndex).toBe(2);
                expect(isCompaction).toBe(false);
                return {
                    content: [{ text: "Continued with compacted context.", type: "text" }],
                    usage: usage(100, 30),
                };
            },
            rows: 26,
        });
        running.add(gym);

        submit(gym, "Load enough detail to fill the context.");
        await firstResponseStarted.promise;
        await gym.terminal.waitForText("Working", 30_000);
        gym.terminal.type("Continue from that work.");
        await gym.terminal.waitForText("› Continue from that work.", 30_000);
        gym.terminal.press("tab");
        await gym.terminal.waitForText("↳ queued Continue from that work.", 30_000);
        releaseFirstResponse.resolve();

        const snapshot = await gym.terminal.waitUntil(
            (candidate) =>
                candidate.text.includes("Context compacted") &&
                candidate.text.includes("Continued with compacted context.") &&
                candidate.scroll.atBottom,
            "a visible automatic compaction row",
            30_000,
        );
        expect(snapshot.text).toMatch(
            /Summarized \d+ older messages; [\d.]+k? → [\d.]+k? tokens\./u,
        );
        await captureReviewImage(snapshot, "automatic-compaction-visible.png");

        submit(gym, "/usage");
        const refreshed = await gym.terminal.waitUntil(
            (candidate) =>
                candidate.text.includes("Context: 130 / 500 · 74% left") &&
                candidate.text.includes("Session total: 580"),
            "authoritative context after compaction inference",
            30_000,
        );
        expect(refreshed.text).not.toContain("Context: ~130");
        await mkdir(usageArtifacts, { recursive: true });
        await renderTerminalSnapshotPng(
            refreshed,
            resolve(usageArtifacts, "post-compaction-context-refresh.png"),
        );
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function usage(input: number, output: number) {
    return {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input,
        output,
        totalTokens: input + output,
    };
}

async function captureReviewImage(snapshot: TerminalSnapshot, fileName: string): Promise<void> {
    const directory = process.env.RIG_GYM_SCREENSHOT_DIR;
    if (directory === undefined) return;
    await renderTerminalSnapshotPng(snapshot, resolve(directory, fileName));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value?: T) => void } {
    let resolvePromise: (value: T | PromiseLike<T>) => void = () => {};
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return {
        promise,
        resolve: (value) => resolvePromise(value as T),
    };
}
