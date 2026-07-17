import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Claude Read default line limit", () => {
    it("returns only the first 2,000 lines when no limit is supplied", async () => {
        let readResult = "";
        const content = Array.from({ length: 2_001 }, (_, index) => `line-${index + 1}`).join("\n");
        const gym = await createGym({
            files: { "long.txt": content },
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { file_path: "/workspace/long.txt" },
                                id: "read-long-file",
                                name: "Read",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(1);
                const lastMessage = request.context.messages.at(-1);
                expect(lastMessage).toMatchObject({
                    isError: false,
                    role: "toolResult",
                    toolName: "Read",
                });
                readResult = messageText(lastMessage);
                return { content: [{ text: "CLAUDE_READ_LIMIT_VERIFIED", type: "text" }] };
            },
            modelId: "anthropic/sonnet-4-6",
            providerId: "claude",
            providerOverrides: ["claude"],
        });
        running.add(gym);

        gym.terminal.type("Read the long file without specifying a range.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("CLAUDE_READ_LIMIT_VERIFIED", 30_000);

        expect(readResult.includes("2000\tline-2000")).toBe(true);
        expect(readResult.includes("2001\tline-2001")).toBe(false);
    }, 120_000);
});

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
