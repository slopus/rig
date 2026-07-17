import { afterEach, describe, expect, it } from "vitest";

import { captureScrollback, createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("active Unicode tool session survives repeated resizes", () => {
    it("reflows wide history without stale drafts while an interactive process waits", async () => {
        const releaseInput = deferred<void>();
        let waitingForRelease = false;
        let processSessionId: number | undefined;
        const initialHistory = [
            "ACTIVE_REFLOW_HISTORY_BEGIN",
            ...Array.from(
                { length: 80 },
                (_, index) =>
                    `Wide history ${String(index).padStart(3, "0")}: 日本語 한국어 Djibouti 🇩🇯 é 👩🏽‍💻`,
            ),
            "ACTIVE_REFLOW_UNIQUE_MIDDLE",
            "ACTIVE_REFLOW_HISTORY_END",
        ].join("\n");
        const finalAnswer = [
            "ACTIVE_UNICODE_OUTPUT_BEGIN",
            ...Array.from(
                { length: 70 },
                (_, index) =>
                    `Final wide row ${String(index).padStart(3, "0")}: 東京 العربية नमस्ते 🚀 ä`,
            ),
            "ACTIVE_UNICODE_OUTPUT_END",
        ].join("\n");
        const command = [
            "printf 'READY_FOR_ACTIVE_RESIZE\\n'",
            "IFS= read -r reply",
            `printf 'ACTIVE_TOOL_OUTPUT:%s 日本語 👩🏽‍💻 é\\n' "$reply"`,
            `printf '%s\\n' "$reply" > active-resize-result.txt`,
        ].join("; ");
        const gym = await createGym({
            cols: 88,
            inference: async (request, callIndex) => {
                const lastMessage = request.context.messages.at(-1);
                const resultText = messageText(lastMessage?.content);
                if (callIndex === 0) {
                    return { content: [{ text: initialHistory, type: "text" }] };
                }
                if (callIndex === 1) {
                    return {
                        content: [
                            {
                                arguments: { cmd: command, yield_time_ms: 250 },
                                id: "start-active-resize-process",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (callIndex === 2) {
                    expect(lastMessage).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "exec_command",
                    });
                    expect(resultText).toContain("READY_FOR_ACTIVE_RESIZE");
                    const match = resultText.match(/Process running with session ID (\d+)/u);
                    expect(match).not.toBeNull();
                    processSessionId = Number(match?.[1]);
                    waitingForRelease = true;
                    await releaseInput.promise;
                    return {
                        content: [
                            {
                                arguments: {
                                    chars: "résumé-東京\n",
                                    session_id: processSessionId,
                                    yield_time_ms: 2_000,
                                },
                                id: "finish-active-resize-process",
                                name: "write_stdin",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (callIndex === 3) {
                    expect(lastMessage).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "write_stdin",
                    });
                    expect(resultText).toContain("ACTIVE_TOOL_OUTPUT:résumé-東京");
                    expect(resultText).toContain("Process exited with code 0");
                    return { content: [{ text: finalAnswer, type: "text" }] };
                }
                expect(callIndex).toBe(4);
                return { content: [{ text: "ACTIVE_REFLOW_FOLLOW_UP_OK", type: "text" }] };
            },
            rows: 22,
        });
        running.add(gym);
        const startupScroll = (await gym.terminal.snapshot()).scroll;

        submit(gym, "Create wide Unicode history before starting a tool.");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("ACTIVE_REFLOW_HISTORY_END") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "initial Unicode history at the bottom",
            30_000,
        );

        submit(gym, "Start the interactive process and wait for my resize checks.");
        const processReady = await gym.terminal.waitUntil(
            (snapshot) =>
                waitingForRelease &&
                snapshot.text.includes("READY_FOR_ACTIVE_RESIZE") &&
                snapshot.text.includes("1 background terminal running") &&
                snapshot.scroll.atBottom,
            "interactive process waiting while inference is gated",
            30_000,
        );
        expect(processReady.scroll.bottomDepartureCount).toBe(startupScroll.bottomDepartureCount);
        expect(processReady.scroll.topArrivalCount).toBe(startupScroll.topArrivalCount);

        const layouts = [
            { cols: 46, draft: "RESIZE_DRAFT_ONE", rows: 14 },
            { cols: 104, draft: "RESIZE_DRAFT_TWO", rows: 28 },
            { cols: 58, draft: "RESIZE_DRAFT_THREE", rows: 18 },
            { cols: 88, draft: "RESIZE_DRAFT_FOUR", rows: 22 },
        ] as const;
        for (const layout of layouts) {
            await resizeWithTransientDraft(gym, layout, processReady.scroll);
        }

        releaseInput.resolve();
        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("ACTIVE_UNICODE_OUTPUT_END") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "interactive tool output and final Unicode answer",
            30_000,
        );
        expect(processSessionId).toBeTypeOf("number");
        await expect(gym.readFile("active-resize-result.txt")).resolves.toBe("résumé-東京\n");
        assertHealthyLayout(completed, 88, 22, processReady.scroll);

        const transcript = await captureScrollback(gym);
        expect(countOccurrences(transcript, "ACTIVE_REFLOW_HISTORY_BEGIN")).toBe(1);
        expect(countOccurrences(transcript, "ACTIVE_REFLOW_UNIQUE_MIDDLE")).toBe(1);
        expect(countOccurrences(transcript, "ACTIVE_REFLOW_HISTORY_END")).toBe(1);
        expect(countOccurrences(transcript, "ACTIVE_UNICODE_OUTPUT_BEGIN")).toBe(1);
        expect(countOccurrences(transcript, "ACTIVE_UNICODE_OUTPUT_END")).toBe(1);
        for (const layout of layouts) expect(transcript).not.toContain(layout.draft);
        expect(transcript).not.toContain("�");

        submit(gym, "Confirm input still works after every active resize.");
        const followUp = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("ACTIVE_REFLOW_FOLLOW_UP_OK") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "follow-up after repeated active resizes",
            30_000,
        );
        expect(followUp.text).toContain("gym off · /workspace");
        expect(followUp.text).not.toContain("�");
        expect(gym.inference.requests.filter(isAgentRequest)).toHaveLength(5);
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

function isAgentRequest(request: Gym["inference"]["requests"][number]): boolean {
    return !request.options.sessionId?.endsWith(":title");
}

async function resizeWithTransientDraft(
    gym: Gym,
    layout: { cols: number; draft: string; rows: number },
    baseline: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): Promise<void> {
    gym.terminal.resize(layout.cols, layout.rows);
    gym.terminal.type(layout.draft);
    const drafted = await gym.terminal.waitUntil(
        (snapshot) =>
            snapshot.rows.length === layout.rows &&
            snapshot.scroll.visibleRows === layout.rows &&
            snapshot.text.includes(layout.draft) &&
            snapshot.scroll.atBottom,
        `${layout.cols} by ${layout.rows} active layout with its transient draft`,
        30_000,
    );
    assertHealthyLayout(drafted, layout.cols, layout.rows, baseline);

    for (const _character of layout.draft) gym.terminal.press("backspace");
    await gym.terminal.waitUntil(
        (snapshot) =>
            !snapshot.text.includes(layout.draft) &&
            snapshot.text.includes("Ask Rig to do anything") &&
            snapshot.rows.length === layout.rows &&
            snapshot.scroll.atBottom,
        `cleared transient draft at ${layout.cols} by ${layout.rows}`,
        30_000,
    );
}

function assertHealthyLayout(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    cols: number,
    rows: number,
    baseline: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.rows).toHaveLength(rows);
    expect(snapshot.scroll.visibleRows).toBe(rows);
    expect(snapshot.scroll.offset + snapshot.scroll.visibleRows).toBe(snapshot.scroll.totalRows);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/work");
    expect(snapshot.text).not.toContain("�");
    expect(snapshot.text).not.toContain("\x1b[200~");
    expect(snapshot.text).not.toContain("\x1b[201~");
    expect(snapshot.cursor.x).toBeLessThan(cols);
    expect(snapshot.cursor.y).toBeLessThan(rows);
}

function countOccurrences(text: string, search: string): number {
    return text.split(search).length - 1;
}
