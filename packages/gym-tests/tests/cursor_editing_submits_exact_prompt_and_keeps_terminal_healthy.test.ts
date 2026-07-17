import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("cursor editing submits the exact prompt and keeps the terminal healthy", () => {
    it("edits in the middle of a line with arrows and backspace before submitting", async () => {
        const expected = "Unicode 🚀 hello world!";
        const gym = await createGym({
            cols: 44,
            inference: [{ content: [{ text: "EDIT_ACCEPTED", type: "text" }] }],
            rows: 18,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        gym.terminal.type("Unicode 🚀 hello wrld");
        gym.terminal.press("left");
        gym.terminal.press("left");
        gym.terminal.press("left");
        gym.terminal.type("o");
        gym.terminal.press("right");
        gym.terminal.press("right");
        gym.terminal.press("right");
        gym.terminal.type("!!");
        gym.terminal.press("backspace");

        const editing = await gym.terminal.waitForText(expected);
        expect(editing.rows).toHaveLength(18);
        expect(editing.cursor.x).toBeLessThan(44);
        expect(editing.cursor.y).toBeLessThan(18);
        expect(editing.scroll.atBottom).toBe(true);
        expect(editing.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(editing.text).not.toContain("�");

        gym.terminal.press("enter");
        const completed = await gym.terminal.waitForText("EDIT_ACCEPTED", 30_000);
        expect(completed.text).toContain("Ask Rig to do anything");
        expect(completed.text).toContain("gym off · /workspace");
        expect(completed.scroll.atBottom).toBe(true);

        const request = agentRequests(gym).at(0);
        expect(lastUserText(request?.context.messages ?? [])).toBe(expected);
    });
});

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
