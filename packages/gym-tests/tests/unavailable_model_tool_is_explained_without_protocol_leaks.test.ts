import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const COLS = 88;
const ROWS = 24;
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("unavailable model tool is explained without protocol leaks", () => {
    it("shows a readable failed action, changes nothing, and accepts a follow-up", async () => {
        const gym = await createGym({
            cols: COLS,
            files: { "protected.txt": "still protected\n" },
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { path: "/workspace/protected.txt" },
                                id: "raw-unavailable-tool-call-id",
                                name: "erase_everything",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 1) {
                    expect(lastMessage).toMatchObject({
                        isError: true,
                        role: "toolResult",
                        toolCallId: "raw-unavailable-tool-call-id",
                        toolName: "erase_everything",
                    });
                    expect(messageText(lastMessage)).toBe(
                        "Unknown tool 'erase_everything' requested by model",
                    );
                    return {
                        content: [{ text: "UNAVAILABLE_TOOL_HANDLED", type: "text" }],
                        delayMs: 500,
                    };
                }

                expect(callIndex).toBe(2);
                expect(lastMessage).toMatchObject({ role: "user" });
                return { content: [{ text: "UNAVAILABLE_TOOL_RECOVERY_CONFIRMED", type: "text" }] };
            },
            rows: ROWS,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "Check the protected file without changing it.");
        const failed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Failed Erase everything") &&
                normalizeWhitespace(snapshot.text).includes(
                    'The model requested "Erase everything", but that tool is not available in this session.',
                ) &&
                snapshot.text.includes("gym off") &&
                snapshot.scroll.atBottom,
            "plain-language unavailable-tool failure",
            30_000,
        );
        expect(failed.text).not.toContain("erase_everything");
        expect(failed.text).not.toContain("raw-unavailable-tool-call-id");
        expect(failed.text).not.toContain("Unknown tool '");
        expect(failed.text).not.toContain("toolCallId");
        expect(failed.text).not.toContain("Failed /workspace/protected.txt");
        assertHealthy(failed, baseline);
        await expect(gym.readFile("protected.txt")).resolves.toBe("still protected\n");

        const handled = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("UNAVAILABLE_TOOL_HANDLED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "assistant recovery after unavailable tool",
            30_000,
        );
        assertHealthy(handled, baseline);

        submit(gym, "Confirm the session still works.");
        const recovered = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("UNAVAILABLE_TOOL_RECOVERY_CONFIRMED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "follow-up after unavailable tool",
            30_000,
        );
        expect(recovered.text).not.toContain("erase_everything");
        expect(recovered.text).not.toContain("raw-unavailable-tool-call-id");
        assertHealthy(recovered, baseline);
        await expect(gym.readFile("protected.txt")).resolves.toBe("still protected\n");
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function messageText(message: { content: unknown } | undefined): string {
    if (typeof message?.content === "string") return message.content;
    if (!Array.isArray(message?.content)) return "";
    return message.content
        .filter(
            (block): block is { text: string; type: "text" } =>
                typeof block === "object" &&
                block !== null &&
                "type" in block &&
                block.type === "text" &&
                "text" in block &&
                typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("");
}

function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/gu, " ");
}

function assertHealthy(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    baseline: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.rows).toHaveLength(ROWS);
    expect(snapshot.rows.every((row) => [...row].length <= COLS)).toBe(true);
    expect(snapshot.scroll.visibleRows).toBe(ROWS);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.cursor.x).toBeLessThan(COLS);
    expect(snapshot.cursor.y).toBeLessThan(ROWS);
    expect(snapshot.title).toContain("Rig");
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    for (const control of ["\u0000", "\u0007", "\u001b", "�"]) {
        expect(snapshot.text).not.toContain(control);
    }
}
