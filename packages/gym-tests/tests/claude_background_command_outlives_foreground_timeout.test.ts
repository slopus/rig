import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Claude background commands without an explicit timeout", () => {
    it("keeps the process alive past the foreground timeout", async () => {
        const completionMarker = "CLAUDE_BACKGROUND_SURVIVED_FOREGROUND_TIMEOUT";
        let taskResultText = "";
        const gym = await createGym({
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);
                const resultText =
                    typeof lastMessage?.content === "string"
                        ? lastMessage.content
                        : (lastMessage?.content ?? [])
                              .filter((block) => block.type === "text")
                              .map((block) => block.text)
                              .join("");

                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: {
                                    command: `sleep 121; printf '${completionMarker}\\n' > background-survived.txt`,
                                    run_in_background: true,
                                },
                                id: "start-claude-background-command",
                                name: "Bash",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 1) {
                    expect(lastMessage).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "Bash",
                    });
                    return {
                        content: [
                            {
                                arguments: { block: true, task_id: "1", timeout: 130_000 },
                                id: "wait-for-claude-background-command",
                                name: "TaskOutput",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(2);
                expect(lastMessage).toMatchObject({
                    isError: false,
                    role: "toolResult",
                    toolName: "TaskOutput",
                });
                taskResultText = resultText;
                return {
                    content: [
                        {
                            text: "CLAUDE_BACKGROUND_TASK_REPORTED",
                            type: "text",
                        },
                    ],
                };
            },
            modelId: "anthropic/sonnet-4-6",
            providerId: "claude",
            providerOverrides: ["claude"],
            timeoutMs: 30_000,
        });
        running.add(gym);

        gym.terminal.type("Run the long task in the background and wait for its result.");
        gym.terminal.press("enter");

        const settled = await gym.terminal.waitUntil(
            (snapshot) => snapshot.text.includes("CLAUDE_BACKGROUND_TASK_REPORTED"),
            "the Claude background command to cross the foreground timeout",
            150_000,
        );

        expect(settled.text).toContain("CLAUDE_BACKGROUND_TASK_REPORTED");
        expect(JSON.parse(taskResultText)).toMatchObject({
            retrieval_status: "success",
            task: {
                status: "completed",
            },
        });
        await expect(gym.readFile("background-survived.txt")).resolves.toBe(
            `${completionMarker}\n`,
        );
    }, 180_000);
});
