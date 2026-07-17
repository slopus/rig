import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("agent edits a fixture with the real shell", () => {
    it("drives the built CLI through Ghostty and writes inside Docker", async () => {
        const gym = await createGym({
            files: { "seed.txt": "from fixture\n" },
            inference: [
                {
                    content: [
                        {
                            arguments: {
                                cmd: "cat seed.txt && printf 'written in docker\\n' > result.txt",
                            },
                            id: "call-1",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                {
                    content: [
                        {
                            text: "Created result.txt from the fixture.",
                            type: "text",
                        },
                    ],
                },
            ],
        });
        running.add(gym);

        gym.terminal.type("Read seed.txt and create result.txt.");
        gym.terminal.press("enter");

        const snapshot = await gym.terminal.waitForText(
            "Created result.txt from the fixture.",
            30_000,
        );
        expect(snapshot.title).toContain("Rig");
        expect(snapshot.text).toContain("from fixture");
        await expect(gym.readFile("result.txt")).resolves.toBe("written in docker\n");

        const agentRequests = gym.inference.requests.filter(
            (request) => !request.options.sessionId?.endsWith(":title"),
        );
        expect(agentRequests).toHaveLength(2);
        expect(agentRequests[1]?.context.messages.at(-1)).toMatchObject({
            isError: false,
            role: "toolResult",
            toolName: "exec_command",
        });
    });
});
