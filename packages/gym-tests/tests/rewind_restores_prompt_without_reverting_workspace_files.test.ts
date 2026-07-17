import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("rewind restores a prompt without reverting workspace files", () => {
    it("removes the selected turn from context, edits it, and keeps prior shell effects", async () => {
        const gym = await createGym({
            cols: 72,
            files: { "seed.txt": "seed\n" },
            inference: [
                {
                    content: [
                        {
                            arguments: {
                                cmd: "cp seed.txt preserved.txt && printf 'changed after first turn\\n' >> preserved.txt",
                            },
                            id: "preserve-file",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                { content: [{ text: "FIRST_TURN_COMPLETE", type: "text" }] },
                { content: [{ text: "SECOND_ORIGINAL_RESPONSE", type: "text" }] },
                { content: [{ text: "SECOND_REVISED_RESPONSE", type: "text" }] },
            ],
            rows: 22,
        });
        running.add(gym);

        gym.terminal.type("Create a file in the first turn.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("FIRST_TURN_COMPLETE", 30_000);
        await expect(gym.readFile("preserved.txt")).resolves.toBe(
            "seed\nchanged after first turn\n",
        );

        gym.terminal.type("Second prompt original");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("SECOND_ORIGINAL_RESPONSE", 30_000);

        gym.terminal.press("escape");
        await gym.terminal.waitForText("Rewind conversation");
        gym.terminal.press("enter");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("› Second prompt original") &&
                !snapshot.text.includes("Rewind conversation") &&
                !snapshot.text.includes("SECOND_ORIGINAL_RESPONSE"),
            "rewound prompt in the composer without the removed response",
            30_000,
        );

        for (let index = 0; index < "original".length; index += 1) {
            gym.terminal.press("backspace");
        }
        gym.terminal.type("revised");
        await gym.terminal.waitForText("Second prompt revised");
        gym.terminal.press("enter");

        const revised = await gym.terminal.waitForText("SECOND_REVISED_RESPONSE", 30_000);
        expect(revised.text).not.toContain("SECOND_ORIGINAL_RESPONSE");
        expect(revised.text).toContain("Ask Rig to do anything");
        expect(revised.scroll.atBottom).toBe(true);
        await expect(gym.readFile("preserved.txt")).resolves.toBe(
            "seed\nchanged after first turn\n",
        );

        const revisedRequest = agentRequests(gym).at(3);
        expect(lastUserText(revisedRequest?.context.messages ?? [])).toBe("Second prompt revised");
        expect(JSON.stringify(revisedRequest?.context.messages)).not.toContain(
            "SECOND_ORIGINAL_RESPONSE",
        );
    }, 120_000);
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
