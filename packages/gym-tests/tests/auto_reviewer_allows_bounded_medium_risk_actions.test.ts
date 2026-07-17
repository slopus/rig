import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Auto reviewer allows bounded medium-risk actions", () => {
    it("does not ask again when the reviewer returns allow with weak authorization", async () => {
        const gym = await createGym({
            cols: 104,
            inference(request, callIndex) {
                if (request.context.systemPrompt?.includes("independent permission reviewer")) {
                    return {
                        content: [
                            {
                                text: JSON.stringify({
                                    decision: "allow",
                                    reason: "This is a bounded and reversible local developer action.",
                                    risk: "medium",
                                    user_authorization: "low",
                                }),
                                type: "text",
                            },
                        ],
                    };
                }
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: "printf 'bounded auto action\\n' > /home/rig/bounded-auto.txt && cp /home/rig/bounded-auto.txt /workspace/bounded-auto-observed.txt",
                                    workdir: "/workspace",
                                },
                                id: "bounded-medium-risk-command",
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
                return { content: [{ text: "BOUNDED_AUTO_ACTION_COMPLETE", type: "text" }] };
            },
            permissionMode: "auto",
            rows: 30,
        });
        running.add(gym);

        submit(gym, "Perform the bounded local developer action.");
        const outcome = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("BOUNDED_AUTO_ACTION_COMPLETE") ||
                snapshot.text.includes("Allow once"),
            "automatic completion or a redundant approval prompt",
            30_000,
        );

        expect(outcome.text).toContain("BOUNDED_AUTO_ACTION_COMPLETE");
        expect(outcome.text).not.toContain("Allow once");
        expect(outcome.text).not.toContain("Waiting for approval");
        await expect(gym.readFile("bounded-auto-observed.txt")).resolves.toBe(
            "bounded auto action\n",
        );
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}
