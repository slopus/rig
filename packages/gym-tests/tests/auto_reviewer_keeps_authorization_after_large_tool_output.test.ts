import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const AUTHORIZATION =
    "AUTO_HISTORY_AUTHORIZATION: I authorize exactly one escalated action that writes the home marker and copies it into the workspace.";
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Auto reviewer authorization after large tool output", () => {
    it("reviews only the escalation and keeps the durable user authorization", async () => {
        let mainCall = 0;
        const gym = await createGym({
            cols: 100,
            inference(request) {
                if (request.context.systemPrompt?.includes("independent permission reviewer")) {
                    return {
                        content: [
                            {
                                text: JSON.stringify({
                                    decision: "allow",
                                    reason: "The user explicitly authorized this exact host write.",
                                    risk: "low",
                                    user_authorization: "high",
                                }),
                                type: "text",
                            },
                        ],
                    };
                }

                const currentMainCall = mainCall++;
                if (currentMainCall === 0) {
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: "head -c 100000 /dev/zero | tr '\\0' x",
                                    max_output_tokens: 30_000,
                                    workdir: "/workspace",
                                    yield_time_ms: 10_000,
                                },
                                id: "large-sandboxed-output",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (currentMainCall === 1) {
                    expect(request.context.messages.at(-1)).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "exec_command",
                    });
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: "printf 'authorized after large output\\n' > /home/rig/authorized-marker.txt && cp /home/rig/authorized-marker.txt /workspace/authorized-marker-observed.txt",
                                    justification:
                                        "Write the exact home marker the user authorized.",
                                    sandbox_permissions: "require_escalated",
                                    workdir: "/workspace",
                                },
                                id: "authorized-escalated-write",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                expect(currentMainCall).toBe(2);
                return {
                    content: [{ text: "AUTO_HISTORY_REGRESSION_COMPLETE", type: "text" }],
                };
            },
            permissionMode: "auto",
            rows: 30,
            timeoutMs: 30_000,
        });
        running.add(gym);

        submit(
            gym,
            `${AUTHORIZATION} First inspect a large local output in the sandbox, then perform that exact escalated action.`,
        );
        await gym.terminal.waitForText("AUTO_HISTORY_REGRESSION_COMPLETE", 30_000);

        await expect(gym.readFile("authorized-marker-observed.txt")).resolves.toBe(
            "authorized after large output\n",
        );
        const reviewRequests = gym.inference.requests.filter((request) =>
            request.context.systemPrompt?.includes("independent permission reviewer"),
        );
        expect(messageText(reviewRequests.at(-1)?.context.messages.at(-1))).toContain(
            AUTHORIZATION,
        );
        expect(reviewRequests).toHaveLength(1);
    }, 120_000);
});

function messageText(message: { content: unknown } | undefined): string {
    return typeof message?.content === "string"
        ? message.content
        : JSON.stringify(message?.content);
}

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}
