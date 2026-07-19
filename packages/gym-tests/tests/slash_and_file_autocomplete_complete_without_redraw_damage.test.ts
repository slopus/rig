import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("file autocomplete quotes paths without redraw damage", () => {
    it("inserts and submits a quoted file mention", async () => {
        const expected = 'Please inspect @"src/alpha beta.ts"';
        const gym = await createGym({
            cols: 64,
            files: {
                "notes/other.md": "other\n",
                "src/alpha beta.ts": "export const alpha = true;\n",
            },
            inference: [{ content: [{ text: "MENTION_ACCEPTED", type: "text" }] }],
            rows: 22,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        gym.terminal.type("Please inspect @alpha");
        const files = await gym.terminal.waitForText("src/alpha beta.ts", 30_000);
        expect(files.text).toContain("alpha beta.ts");
        gym.terminal.press("tab");
        const completedMention = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes(`› ${expected}`) &&
                !snapshot.rows.some((row) => row.trimStart().startsWith("→")),
            "the completed file mention in the composer",
        );
        expect(completedMention.text).not.toContain("�");
        gym.terminal.press("enter");

        await gym.terminal.waitUntil(
            () => agentRequests(gym).length === 1,
            "the completed mention to reach inference",
            2_000,
        );

        const completed = await Promise.race([
            gym.terminal.waitForText("MENTION_ACCEPTED", 10_000),
            gym.exit().then(async ({ exitCode, signal }) => {
                const snapshot = await gym.terminal.snapshot();
                throw new Error(
                    `Rig exited before accepting the mention (code ${exitCode}, signal ${String(signal)}).\n\n${snapshot.text}`,
                );
            }),
        ]);
        expect(completed.rows).toHaveLength(22);
        expect(completed.scroll.atBottom).toBe(true);
        expect(completed.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(completed.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
        expect(lastUserText(agentRequests(gym).at(0)?.context.messages ?? [])).toBe(expected);
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
