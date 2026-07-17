import { afterEach, describe, expect, it } from "vitest";

import { captureScrollback, createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("middle scrollback anchor survives delayed tool output", () => {
    it("keeps the same historical rows visible while a shell result and long answer arrive", async () => {
        const delayedTool = deferred<void>();
        const initialHistory = [
            "MIDDLE_HISTORY_BEGIN",
            ...Array.from(
                { length: 130 },
                (_, index) => `Historical anchor row ${String(index).padStart(3, "0")}`,
            ),
            "MIDDLE_HISTORY_END",
        ].join("\n");
        const delayedAnswer = [
            "MIDDLE_DELAYED_ANSWER_BEGIN",
            ...Array.from(
                { length: 80 },
                (_, index) => `Delayed answer row ${String(index).padStart(3, "0")}`,
            ),
            "MIDDLE_DELAYED_ANSWER_END",
        ].join("\n");
        const command = [
            "printf 'MIDDLE_TOOL_OUTPUT_BEGIN\\n'",
            "printf 'shell row 01\\nshell row 02\\n'",
            "printf 'MIDDLE_TOOL_OUTPUT_END\\n'",
        ].join("; ");
        const gym = await createGym({
            cols: 68,
            inference: async (_request, callIndex) => {
                if (callIndex === 0) {
                    return { content: [{ text: initialHistory, type: "text" }] };
                }
                if (callIndex === 1) {
                    await delayedTool.promise;
                    return {
                        content: [
                            {
                                arguments: { cmd: command },
                                id: "middle-anchor-tool",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (callIndex === 2) {
                    return { content: [{ text: delayedAnswer, type: "text" }] };
                }
                expect(callIndex).toBe(3);
                return { content: [{ text: "MIDDLE_ANCHOR_FOLLOW_UP_OK", type: "text" }] };
            },
            rows: 16,
        });
        running.add(gym);
        const startupScroll = (await gym.terminal.snapshot()).scroll;

        submit(gym, "Create history with a stable middle anchor.");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("MIDDLE_HISTORY_END") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "initial history at the bottom",
            30_000,
        );

        submit(gym, "Run a delayed shell command and then answer at length.");
        await gym.terminal.waitForText("Working", 30_000);
        gym.terminal.scrollBy(-45);
        const middle = await gym.terminal.snapshot();
        expect(middle.scroll.atTop).toBe(false);
        expect(middle.scroll.atBottom).toBe(false);
        expect(middle.scroll.offset).toBeGreaterThan(0);
        expect(middle.scroll.offset + middle.scroll.visibleRows).toBeLessThan(
            middle.scroll.totalRows,
        );
        expect(middle.scroll.bottomDepartureCount).toBe(startupScroll.bottomDepartureCount + 1);
        expect(middle.scroll.topArrivalCount).toBe(startupScroll.topArrivalCount);
        const anchoredOffset = middle.scroll.offset;
        const anchoredRows = middle.rows;
        const anchoredText = middle.text;
        const rowsBeforeOutput = middle.scroll.totalRows;

        delayedTool.resolve();
        const outputWhileReading = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.scroll.totalRows >= rowsBeforeOutput + 30 &&
                snapshot.scroll.offset === anchoredOffset &&
                !snapshot.scroll.atTop &&
                !snapshot.scroll.atBottom,
            "tool and assistant output to extend scrollback without moving the middle anchor",
            30_000,
        );
        expect(outputWhileReading.rows).toEqual(anchoredRows);
        expect(outputWhileReading.text).toBe(anchoredText);
        expect(outputWhileReading.scroll.bottomDepartureCount).toBe(
            middle.scroll.bottomDepartureCount,
        );
        expect(outputWhileReading.scroll.topArrivalCount).toBe(middle.scroll.topArrivalCount);

        gym.terminal.scrollToBottom();
        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("MIDDLE_DELAYED_ANSWER_END") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "completed delayed tool flow at the bottom",
            30_000,
        );
        assertHealthyBottom(completed, middle.scroll);

        const transcript = await captureScrollback(gym);
        expect(countOccurrences(transcript, "MIDDLE_HISTORY_BEGIN")).toBe(1);
        expect(countOccurrences(transcript, "MIDDLE_HISTORY_END")).toBe(1);
        expect(countOccurrences(transcript, "MIDDLE_DELAYED_ANSWER_BEGIN")).toBe(1);
        expect(countOccurrences(transcript, "MIDDLE_DELAYED_ANSWER_END")).toBe(1);
        expect(transcript).not.toContain("�");

        submit(gym, "Confirm the middle-anchor flow remains usable.");
        const followUp = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("MIDDLE_ANCHOR_FOLLOW_UP_OK") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "follow-up response after restoring live output",
            30_000,
        );
        expect(followUp.text).toContain("gym off · /workspace");
        expect(followUp.text).not.toContain("�");

        const agentRequests = gym.inference.requests.filter(isAgentRequest);
        expect(agentRequests).toHaveLength(4);
        expect(agentRequests[2]?.context.messages.at(-1)).toMatchObject({
            isError: false,
            role: "toolResult",
            toolName: "exec_command",
        });
        expect(messageText(agentRequests[2]?.context.messages.at(-1)?.content)).toContain(
            "MIDDLE_TOOL_OUTPUT_END",
        );
    }, 120_000);
});

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

function isAgentRequest(request: Gym["inference"]["requests"][number]): boolean {
    return !request.options.sessionId?.endsWith(":title");
}

function messageText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .filter(
            (block): block is { text: string } =>
                typeof block === "object" &&
                block !== null &&
                "text" in block &&
                typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("");
}

function assertHealthyBottom(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    middleScroll: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.rows).toHaveLength(16);
    expect(snapshot.scroll.visibleRows).toBe(16);
    expect(snapshot.scroll.offset + snapshot.scroll.visibleRows).toBe(snapshot.scroll.totalRows);
    expect(snapshot.scroll.bottomDepartureCount).toBe(middleScroll.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(middleScroll.topArrivalCount);
    expect(snapshot.text).toContain("gym off · /workspace");
    expect(snapshot.text).not.toContain("�");
    expect(snapshot.cursor.x).toBeLessThan(68);
    expect(snapshot.cursor.y).toBeLessThan(16);
}

function countOccurrences(text: string, search: string): number {
    return text.split(search).length - 1;
}
