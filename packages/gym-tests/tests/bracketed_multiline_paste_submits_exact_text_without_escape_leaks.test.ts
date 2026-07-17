import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("bracketed multiline paste submits exact text without escape leaks", () => {
    it("normalizes editor tabs while preserving Unicode and line breaks", async () => {
        const pasted = "  first line\n\tsecond 日本語\nthird 🧪  ";
        const expected = pasted.replaceAll("\t", "    ").trim();
        const gym = await createGym({
            cols: 52,
            inference: [{ content: [{ text: "PASTE_ACCEPTED", type: "text" }] }],
            rows: 20,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        gym.terminal.paste(pasted);
        const editing = await gym.terminal.waitForText("second 日本語", 30_000);
        expect(editing.text).toContain("third 🧪");
        assertNoTerminalCorruption(editing);
        expect(editing.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(editing.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        gym.terminal.press("enter");
        const completed = await gym.terminal.waitForText("PASTE_ACCEPTED", 30_000);
        assertNoTerminalCorruption(completed);
        expect(lastUserText(agentRequests(gym).at(0)?.context.messages ?? [])).toBe(expected);
    });
});

function assertNoTerminalCorruption(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
): void {
    expect(snapshot.rows).toHaveLength(20);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.text).not.toContain("\x1b[200~");
    expect(snapshot.text).not.toContain("\x1b[201~");
    expect(snapshot.text).not.toContain("�");
}

function agentRequests(gym: Gym) {
    return gym.inference.requests.filter(
        (request) => !request.options.sessionId?.endsWith(":title"),
    );
}

function lastUserText(messages: readonly { role: string; content: unknown }[]): string | undefined {
    const message = [...messages].reverse().find((candidate) => candidate.role === "user");
    if (typeof message?.content === "string") return message.content;
    if (!Array.isArray(message?.content)) return undefined;
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
