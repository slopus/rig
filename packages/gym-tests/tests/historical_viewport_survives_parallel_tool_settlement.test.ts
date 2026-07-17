import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { captureScrollback, createGym, waitForTerminalOutput, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("parallel tool settlement while reading terminal history", () => {
    it("keeps an exact middle anchor when an early tool completes below the viewport", async () => {
        const history = [
            "PARALLEL_SETTLEMENT_HISTORY_BEGIN",
            ...Array.from(
                { length: 140 },
                (_, index) => `Parallel settlement history row ${String(index).padStart(3, "0")}`,
            ),
            "PARALLEL_SETTLEMENT_HISTORY_END",
        ].join("\n");
        const slowCommand = [
            "read -r _ < .release-first-tool",
            "rm .release-first-tool",
            "printf 'FIRST_PARALLEL_TOOL_COMPLETE\\n'",
        ].join("; ");
        const fastCommand = [
            "printf 'SECOND_PARALLEL_TOOL_BEGIN\\n'",
            "seq 1 110",
            "printf 'SECOND_PARALLEL_TOOL_COMPLETE\\n'",
        ].join("; ");
        const gym = await createGym({
            cols: 68,
            inference: [
                { content: [{ text: history, type: "text" }] },
                {
                    content: [
                        {
                            arguments: { cmd: slowCommand },
                            id: "slow-parallel-tool",
                            name: "exec_command",
                            type: "toolCall",
                        },
                        {
                            arguments: { cmd: fastCommand },
                            id: "fast-parallel-tool",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                {
                    content: [{ text: "PARALLEL_SETTLEMENT_ASSISTANT_COMPLETE", type: "text" }],
                },
                { content: [{ text: "PARALLEL_SETTLEMENT_FOLLOW_UP", type: "text" }] },
            ],
            rows: 16,
        });
        running.add(gym);
        await gym.runInContainer("mkfifo", [".release-first-tool"]);

        submit(gym, "Create stable history for parallel tool settlement.");
        await waitForIdleText(gym, "PARALLEL_SETTLEMENT_HISTORY_END");

        const output: string[] = [];
        const stopOutputCapture = gym.terminal.onOutput((data) => output.push(data));
        submit(gym, "Run both parallel tools and wait for the first one.");
        await waitForTerminalOutput(gym, "SECOND_PARALLEL_TOOL_COMPLETE", 30_000);

        gym.terminal.scrollToTop();
        gym.terminal.scrollBy(70);
        const anchored = await gym.terminal.snapshot();
        expect(anchored.scroll.atTop).toBe(false);
        expect(anchored.scroll.atBottom).toBe(false);
        const anchor = historicalAnchor(anchored);
        await writeProof(gym, "parallel-settlement-01-anchored.png");
        const outputStart = output.length;

        gym.terminal.scrollToBottom();
        const liveToolBottom = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("• Running read -r _ < .release-first-tool") &&
                snapshot.text.includes("esc to interrupt") &&
                !snapshot.text.includes("FIRST_PARALLEL_TOOL_COMPLETE") &&
                snapshot.scroll.atBottom,
            "the current live tail while the first tool remains gated",
            30_000,
        );
        expect(liveToolBottom.scroll.offset + liveToolBottom.scroll.visibleRows).toBe(
            liveToolBottom.scroll.totalRows,
        );

        gym.terminal.scrollToTop();
        gym.terminal.scrollBy(anchor.offset);
        const anchoredAgain = await gym.terminal.snapshot();
        expect(anchoredAgain.rows).toEqual(anchor.rows);
        expect(anchoredAgain.text).toBe(anchor.text);
        const settlementAnchor = historicalAnchor(anchoredAgain);

        await gym.runInContainer("sh", ["-c", "printf 'release\\n' > .release-first-tool"]);
        await waitForTerminalOutput(gym, "PARALLEL_SETTLEMENT_ASSISTANT_COMPLETE", 30_000);
        const settledWhileReading = await gym.terminal.snapshot();
        assertHistoricalAnchor(settledWhileReading, settlementAnchor);
        const settlementOutput = output.slice(outputStart).join("");
        expect(settlementOutput).not.toContain("\x1b[3J");
        expect(settlementOutput).not.toContain("\x1b[2J\x1b[H");
        await writeProof(gym, "parallel-settlement-02-complete-while-anchored.png");
        await writeTrace("parallel-settlement-output.json", output.slice(outputStart));

        for (let cycle = 0; cycle < 3; cycle += 1) {
            gym.terminal.scrollToBottom();
            const bottom = await gym.terminal.waitUntil(
                (snapshot) =>
                    snapshot.text.includes("PARALLEL_SETTLEMENT_ASSISTANT_COMPLETE") &&
                    snapshot.text.includes("Ask Rig to do anything") &&
                    snapshot.scroll.atBottom,
                `current live tail after return-to-bottom cycle ${String(cycle + 1)}`,
                30_000,
            );
            expect(bottom.scroll.offset + bottom.scroll.visibleRows).toBe(bottom.scroll.totalRows);
            expect(bottom.text).not.toContain("�");
            if (cycle === 2) break;
            gym.terminal.scrollBy(-35);
            const reading = await gym.terminal.snapshot();
            expect(reading.scroll.atBottom).toBe(false);
        }
        await writeProof(gym, "parallel-settlement-03-returned-to-bottom.png");
        stopOutputCapture();

        const scrollback = await captureScrollback(gym);
        expect(countOccurrences(scrollback, "PARALLEL_SETTLEMENT_HISTORY_BEGIN")).toBe(1);
        expect(countOccurrences(scrollback, "PARALLEL_SETTLEMENT_HISTORY_END")).toBe(1);
        expect(countRowsContaining(scrollback, "└ FIRST_PARALLEL_TOOL_COMPLETE")).toBe(1);
        expect(countRowsContaining(scrollback, "└ SECOND_PARALLEL_TOOL_BEGIN")).toBe(1);
        expect(countOccurrences(scrollback, "PARALLEL_SETTLEMENT_ASSISTANT_COMPLETE")).toBe(1);

        submit(gym, "Confirm output still follows after repeated scroll cycles.");
        const followUp = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("PARALLEL_SETTLEMENT_FOLLOW_UP") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "follow-up output after repeated history cycles",
            30_000,
        );
        expect(followUp.text).toContain("gym off · /workspace");
    }, 120_000);
});

interface HistoricalAnchor {
    bottomDepartureCount: number;
    offset: number;
    rows: readonly string[];
    text: string;
    topArrivalCount: number;
}

function historicalAnchor(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
): HistoricalAnchor {
    return {
        bottomDepartureCount: snapshot.scroll.bottomDepartureCount,
        offset: snapshot.scroll.offset,
        rows: snapshot.rows,
        text: snapshot.text,
        topArrivalCount: snapshot.scroll.topArrivalCount,
    };
}

function assertHistoricalAnchor(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    anchor: HistoricalAnchor,
): void {
    expect(snapshot.scroll.atTop).toBe(false);
    expect(snapshot.scroll.atBottom).toBe(false);
    expect(snapshot.scroll.offset).toBe(anchor.offset);
    expect(snapshot.scroll.bottomDepartureCount).toBe(anchor.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(anchor.topArrivalCount);
    expect(snapshot.rows).toEqual(anchor.rows);
    expect(snapshot.text).toBe(anchor.text);
}

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

async function waitForIdleText(gym: Gym, text: string): Promise<void> {
    await gym.terminal.waitUntil(
        (snapshot) =>
            snapshot.text.includes(text) &&
            snapshot.text.includes("Ask Rig to do anything") &&
            snapshot.scroll.atBottom,
        `idle response containing ${text}`,
        30_000,
    );
}

async function writeProof(gym: Gym, name: string): Promise<void> {
    const directory = process.env.RIG_GYM_PROOF_DIR;
    if (directory === undefined) return;
    await gym.terminal.screenshot(resolve(directory, name));
}

async function writeTrace(name: string, chunks: readonly string[]): Promise<void> {
    const directory = process.env.RIG_GYM_PROOF_DIR;
    if (directory === undefined) return;
    await mkdir(directory, { recursive: true });
    await writeFile(
        resolve(directory, name),
        `${JSON.stringify(
            chunks.map((data, index) => ({
                clearsDisplay: data.includes("\x1b[2J"),
                clearsScrollback: data.includes("\x1b[3J"),
                data,
                index,
            })),
            null,
            2,
        )}\n`,
    );
}

function countOccurrences(value: string, search: string): number {
    return value.split(search).length - 1;
}

function countRowsContaining(value: string, search: string): number {
    return value.split("\n").filter((row) => row.includes(search)).length;
}
