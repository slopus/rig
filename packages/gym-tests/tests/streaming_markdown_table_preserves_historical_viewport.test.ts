import { afterEach, describe, expect, it } from "vitest";

import {
    captureScrollback,
    createGym,
    waitForFile,
    waitForTerminalOutput,
    type Gym,
} from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("streaming Markdown table while reading history", () => {
    it("keeps exact middle scrollback rows anchored through table reflow", async () => {
        const releaseAssistant = deferred<void>();
        const assistantRequestStarted = deferred<void>();
        const initialHistory = [
            "VIEWPORT_HISTORY_BEGIN",
            ...Array.from(
                { length: 150 },
                (_, index) => `Historical viewport row ${String(index).padStart(3, "0")}`,
            ),
            "VIEWPORT_HISTORY_END",
        ].join("\n");
        const streamedAnswer = [
            "STREAMED_VIEWPORT_UPDATE_BEGIN",
            "",
            "| Row | Value |",
            "| --- | --- |",
            ...Array.from(
                { length: 100 },
                (_, index) =>
                    `| ${String(index).padStart(3, "0")} | ${"x".repeat(2 + (index % 25))} |`,
            ),
            "",
            "STREAMED_VIEWPORT_UPDATE_END",
        ].join("\n");
        const command =
            "sleep 8; printf 'BACKGROUND_VIEWPORT_COMPLETED\\n' > background-viewport.txt";
        const gym = await createGym({
            cols: 68,
            inference: async (request, callIndex) => {
                if (callIndex === 0) {
                    return { content: [{ text: initialHistory, type: "text" }] };
                }
                if (callIndex === 1) {
                    return {
                        content: [
                            {
                                arguments: { cmd: command, yield_time_ms: 100 },
                                id: "historical-viewport-background-command",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                expect(callIndex).toBe(2);
                expect(request.context.messages.at(-1)).toMatchObject({
                    isError: false,
                    role: "toolResult",
                    toolName: "exec_command",
                });
                assistantRequestStarted.resolve();
                await releaseAssistant.promise;
                return {
                    content: [{ text: streamedAnswer, type: "text" }],
                    textDeltaChunkSize: 64,
                    textDeltaDelayMs: 30,
                };
            },
            rows: 16,
        });
        running.add(gym);

        submit(gym, "Create stable history for viewport inspection.");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("VIEWPORT_HISTORY_END") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "initial viewport history at the bottom",
            30_000,
        );

        submit(gym, "Start one background terminal, then stream an answer.");
        await assistantRequestStarted.promise;
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("1 background terminal running") &&
                snapshot.text.includes("Working") &&
                snapshot.scroll.atBottom,
            "background terminal and live status",
            30_000,
        );

        gym.terminal.scrollBy(-55);
        const anchored = await gym.terminal.snapshot();
        expect(anchored.scroll.atTop).toBe(false);
        expect(anchored.scroll.atBottom).toBe(false);
        expect(anchored.scroll.offset).toBeGreaterThan(0);
        expect(anchored.scroll.offset + anchored.scroll.visibleRows).toBeLessThan(
            anchored.scroll.totalRows,
        );

        const anchor = historicalAnchor(anchored);
        await writeProof(gym, "table-01-anchored.png");

        const animated = await gym.terminal.waitUntil(
            (snapshot) => snapshot.outputRevision > anchored.outputRevision,
            "a live status redraw while reading history",
            10_000,
        );
        assertHistoricalAnchor(animated, anchor);

        const inputRevisionBeforeHostCopy = gym.terminal.inputRevision;
        const copiedSelection = hostTerminalCopy(anchor.rows.slice(4, 10));
        expect(copiedSelection).toBe(anchor.rows.slice(4, 10).join("\n"));
        const afterHostCopy = await gym.terminal.snapshot();
        expect(gym.terminal.inputRevision).toBe(inputRevisionBeforeHostCopy);
        assertHistoricalAnchor(afterHostCopy, anchor);

        const streamedOutput = waitForTerminalOutput(gym, "STREAMED_VIEWPORT_UPDATE_END", 30_000);
        releaseAssistant.resolve();
        await streamedOutput;
        const afterStream = await gym.terminal.snapshot();
        expect(afterStream.scroll.totalRows).toBeGreaterThan(anchor.totalRows + 20);
        assertHistoricalAnchor(afterStream, anchor);
        await writeProof(gym, "table-02-after-stream.png");

        const backgroundCompletionOutput = waitForTerminalOutput(
            gym,
            "Background terminal completed",
            30_000,
        );
        await waitForFile(gym, "background-viewport.txt", 30_000);
        await backgroundCompletionOutput;
        const afterBackgroundCompletion = await gym.terminal.snapshot();
        expect(afterBackgroundCompletion.outputRevision).toBeGreaterThan(
            afterStream.outputRevision,
        );
        assertHistoricalAnchor(afterBackgroundCompletion, anchor);
        await writeProof(gym, "table-03-after-background-completion.png");

        gym.terminal.scrollToBottom();
        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("STREAMED_VIEWPORT_UPDATE_END") &&
                snapshot.text.includes("Background terminal completed") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "all live updates after returning to the bottom",
            30_000,
        );
        expect(completed.rows).toHaveLength(16);
        expect(completed.text).not.toContain("Session interrupted");
        expect(completed.text).not.toContain("�");

        const transcript = await captureScrollback(gym);
        expect(countOccurrences(transcript, "VIEWPORT_HISTORY_BEGIN")).toBe(1);
        expect(countOccurrences(transcript, "VIEWPORT_HISTORY_END")).toBe(1);
        expect(countOccurrences(transcript, "STREAMED_VIEWPORT_UPDATE_BEGIN")).toBe(1);
        expect(countOccurrences(transcript, "STREAMED_VIEWPORT_UPDATE_END")).toBe(1);
        expect(countOccurrences(transcript, "Background terminal completed")).toBe(1);

        const agentRequests = gym.inference.requests.filter(
            (request) => !request.options.sessionId?.endsWith(":title"),
        );
        expect(agentRequests).toHaveLength(3);
    }, 120_000);
});

interface HistoricalAnchor {
    offset: number;
    rows: readonly string[];
    text: string;
    totalRows: number;
}

function historicalAnchor(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
): HistoricalAnchor {
    return {
        offset: snapshot.scroll.offset,
        rows: snapshot.rows,
        text: snapshot.text,
        totalRows: snapshot.scroll.totalRows,
    };
}

function assertHistoricalAnchor(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    anchor: HistoricalAnchor,
): void {
    expect(snapshot.scroll.atTop).toBe(false);
    expect(snapshot.scroll.atBottom).toBe(false);
    expect(snapshot.scroll.offset).toBe(anchor.offset);
    expect(snapshot.rows).toEqual(anchor.rows);
    expect(snapshot.text).toBe(anchor.text);
}

function hostTerminalCopy(selectedRows: readonly string[]): string {
    // With a native terminal selection, Cmd-C is intercepted by the host terminal and sends no
    // input bytes to Rig. Gym cannot model native selection chrome, so preserve that boundary here.
    return selectedRows.join("\n");
}

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
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

async function writeProof(gym: Gym, name: string): Promise<void> {
    const directory = process.env.RIG_GYM_PROOF_DIR;
    if (directory === undefined) return;
    await gym.terminal.screenshot(`${directory}/${name}`);
}

function countOccurrences(text: string, search: string): number {
    return text.split(search).length - 1;
}
