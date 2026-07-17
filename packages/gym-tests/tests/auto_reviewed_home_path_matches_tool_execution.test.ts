import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Auto-reviewed home-relative file paths", () => {
    it("executes the same home path that the user approved", async () => {
        const gym = await createGym({
            inference(request, callIndex) {
                if (request.context.systemPrompt?.includes("independent permission reviewer")) {
                    expect(callIndex).toBe(1);
                    expect(messageText(request.context.messages.at(-1))).toContain("~");
                    return {
                        content: [
                            {
                                text: JSON.stringify({
                                    decision: "ask",
                                    reason: "Writing to the home directory needs explicit approval.",
                                    risk: "high",
                                    user_authorization: "medium",
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
                                    content: "must not become a workspace file",
                                    file_path: "~",
                                },
                                id: "write-reviewed-home-path",
                                name: "Write",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(2);
                const result = request.context.messages.at(-1);
                expect(result).toMatchObject({
                    isError: true,
                    role: "toolResult",
                    toolName: "Write",
                });
                expect(messageText(result)).toContain("Read it first before writing to it");
                return {
                    content: [{ text: "HOME_PATH_EXECUTION_MATCHED_REVIEW", type: "text" }],
                };
            },
            permissionMode: "auto",
            providerId: "claude",
            providerOverrides: ["claude"],
        });
        running.add(gym);

        submit(gym, "Try to write to my home directory, and ask me before doing it.");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Allow once") &&
                snapshot.text.includes("Deny") &&
                snapshot.text.includes("~"),
            "the approval prompt for the home-relative path",
            30_000,
        );
        gym.terminal.press("enter");

        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("HOME_PATH_EXECUTION_MATCHED_REVIEW") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "the failed directory write and recovered composer",
            30_000,
        );
        await expect(gym.readFile("~")).rejects.toMatchObject({ code: "ENOENT" });
    }, 90_000);
});

function messageText(message: { content: unknown } | undefined): string {
    if (typeof message?.content === "string") return message.content;
    if (!Array.isArray(message?.content)) return "";
    return message.content
        .filter(
            (block): block is { text: string } =>
                typeof block === "object" &&
                block !== null &&
                "text" in block &&
                typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("\n");
}

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}
