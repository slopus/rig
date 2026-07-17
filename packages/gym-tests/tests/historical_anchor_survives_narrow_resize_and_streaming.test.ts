import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { captureScrollback, createGym, waitForTerminalOutput, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("narrow resize while reading history and receiving output", () => {
    it("keeps the selected logical anchor without clearing or replaying history", async () => {
        const releaseStream = deferred<void>();
        const streamStarted = deferred<void>();
        const history = [
            "NARROW_RESIZE_HISTORY_BEGIN",
            ...Array.from(
                { length: 130 },
                (_, index) =>
                    `NARROW_RESIZE_ANCHOR_${String(index).padStart(3, "0")} stable text for native terminal reflow`,
            ),
            "NARROW_RESIZE_HISTORY_END",
        ].join("\n");
        const stream = [
            "NARROW_RESIZE_STREAM_BEGIN",
            ...Array.from(
                { length: 70 },
                (_, index) => `Narrow resize streamed row ${String(index).padStart(3, "0")}`,
            ),
            "NARROW_RESIZE_STREAM_END",
        ].join("\n");
        const gym = await createGym({
            cols: 72,
            inference: async (_request, callIndex) => {
                if (callIndex === 0) return { content: [{ text: history, type: "text" }] };
                if (callIndex > 1) {
                    return { content: [{ text: "NARROW_RESIZE_FOLLOW_UP", type: "text" }] };
                }
                streamStarted.resolve();
                await releaseStream.promise;
                return {
                    content: [{ text: stream, type: "text" }],
                    textDeltaChunkSize: 21,
                    textDeltaDelayMs: 12,
                };
            },
            rows: 18,
        });
        running.add(gym);

        submit(gym, "Create narrow resize history.");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("NARROW_RESIZE_HISTORY_END") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "narrow resize history at the bottom",
            30_000,
        );
        submit(gym, "Stream more output after the resize begins.");
        await streamStarted.promise;
        await gym.terminal.waitForText("Working", 30_000);

        gym.terminal.scrollToTop();
        gym.terminal.scrollBy(72);
        const anchored = await gym.terminal.snapshot();
        expect(anchored.scroll.atTop).toBe(false);
        expect(anchored.scroll.atBottom).toBe(false);
        const selectedAnchor = anchored.rows.find((row) => row.includes("NARROW_RESIZE_ANCHOR_"));
        expect(selectedAnchor).toBeDefined();
        if (selectedAnchor === undefined) throw new Error("Resize anchor was not visible.");
        const selectedMarker = /NARROW_RESIZE_ANCHOR_\d{3}/u.exec(selectedAnchor)?.[0];
        expect(selectedMarker).toBeDefined();
        if (selectedMarker === undefined) throw new Error("Resize marker was not visible.");
        const baselineCounters = anchored.scroll;
        await writeProof(gym, "resize-01-wide-anchored.png");

        const output: string[] = [];
        const stopOutputCapture = gym.terminal.onOutput((data) => output.push(data));
        gym.terminal.resize(52, 14);
        const narrow = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.rows.length === 14 &&
                snapshot.scroll.visibleRows === 14 &&
                snapshot.rows.some((row) => row.includes(selectedMarker)),
            "the selected logical marker after narrow reflow",
            30_000,
        );
        expect(narrow.scroll.atTop).toBe(false);
        expect(narrow.scroll.atBottom).toBe(false);
        expect(narrow.scroll.bottomDepartureCount).toBe(baselineCounters.bottomDepartureCount);
        expect(narrow.scroll.topArrivalCount).toBe(baselineCounters.topArrivalCount);
        expect(output.join("")).not.toContain("\x1b[3J");
        await writeProof(gym, "resize-02-narrow-anchored.png");

        releaseStream.resolve();
        await waitForTerminalOutput(gym, "NARROW_RESIZE_STREAM_END", 30_000);
        const streamed = await gym.terminal.snapshot();
        expect(streamed.scroll.atTop).toBe(false);
        expect(streamed.scroll.atBottom).toBe(false);
        expect(streamed.rows).toEqual(narrow.rows);
        expect(streamed.text).toBe(narrow.text);
        expect(streamed.rows.some((row) => row.includes(selectedMarker))).toBe(true);
        expect(streamed.scroll.offset).toBe(narrow.scroll.offset);
        expect(streamed.scroll.bottomDepartureCount).toBe(narrow.scroll.bottomDepartureCount);
        expect(streamed.scroll.topArrivalCount).toBe(narrow.scroll.topArrivalCount);
        expect(output.join("")).not.toContain("\x1b[3J");
        expect(output.join("")).not.toContain("\x1b[2J\x1b[H");
        stopOutputCapture();
        await writeProof(gym, "resize-03-streamed-while-anchored.png");

        gym.terminal.scrollToBottom();
        const bottom = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("NARROW_RESIZE_STREAM_END") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "current narrow live tail after returning to the bottom",
            30_000,
        );
        expect(bottom.rows).toHaveLength(14);
        expect(bottom.scroll.offset + bottom.scroll.visibleRows).toBe(bottom.scroll.totalRows);
        expect(bottom.text).not.toContain("�");
        await writeProof(gym, "resize-04-returned-to-bottom.png");

        submit(gym, "Render one more revision after returning to the bottom.");
        const revisedBottom = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("NARROW_RESIZE_FOLLOW_UP") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "a healthy later revision at the narrow bottom",
            30_000,
        );
        expect(revisedBottom.rows).toHaveLength(14);
        expect(revisedBottom.text).not.toContain("�");

        const scrollback = await captureScrollback(gym);
        await writeScrollbackProof(scrollback);
        await writeRawOutputProof(output.join(""));
        expect(countOccurrences(scrollback, "NARROW_RESIZE_HISTORY_BEGIN")).toBe(1);
        expect(countOccurrences(scrollback, selectedMarker)).toBe(1);
        expect(countOccurrences(scrollback, "NARROW_RESIZE_HISTORY_END")).toBe(1);
        expect(countOccurrences(scrollback, "NARROW_RESIZE_STREAM_BEGIN")).toBe(1);
        expect(countOccurrences(scrollback, "NARROW_RESIZE_STREAM_END")).toBe(1);
        expect(countOccurrences(scrollback, "NARROW_RESIZE_FOLLOW_UP")).toBe(1);
        expect(maximumBlankRun(scrollback)).toBeLessThanOrEqual(4);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function deferred<T>(): { promise: Promise<T>; resolve: (value?: T) => void } {
    let resolvePromise: (value: T | PromiseLike<T>) => void = () => {};
    const promise = new Promise<T>((resolvePromiseValue) => {
        resolvePromise = resolvePromiseValue;
    });
    return {
        promise,
        resolve: (value) => resolvePromise(value as T),
    };
}

async function writeProof(gym: Gym, name: string): Promise<void> {
    const directory = process.env.RIG_GYM_PROOF_DIR;
    if (directory === undefined) return;
    await gym.terminal.screenshot(resolve(directory, name));
}

async function writeScrollbackProof(scrollback: string): Promise<void> {
    const directory = process.env.RIG_GYM_PROOF_DIR;
    if (directory === undefined) return;
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "resize-complete-scrollback.txt"), `${scrollback}\n`);
}

async function writeRawOutputProof(output: string): Promise<void> {
    const directory = process.env.RIG_GYM_PROOF_DIR;
    if (directory === undefined) return;
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "resize-raw-output.txt"), output);
}

function countOccurrences(value: string, search: string): number {
    return value.split(search).length - 1;
}

function maximumBlankRun(value: string): number {
    let maximum = 0;
    let current = 0;
    for (const row of value.split("\n")) {
        current = row.trim().length === 0 ? current + 1 : 0;
        maximum = Math.max(maximum, current);
    }
    return maximum;
}
