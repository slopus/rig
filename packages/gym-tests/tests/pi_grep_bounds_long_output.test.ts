import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Pi grep output bounds", () => {
    it("truncates long matches and caps combined output at 50KB", async () => {
        let grepResult = "";
        const content = Array.from(
            { length: 101 },
            (_, index) => `needle-${String(index).padStart(3, "0")}-${"x".repeat(600)}`,
        ).join("\n");
        const gym = await createGym({
            environment: {
                AWS_BEARER_TOKEN_BEDROCK: "gym-placeholder-token",
                RIG_GYM_PROVIDER_OVERRIDES: "bedrock",
            },
            files: { "long.txt": content },
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { path: "/workspace", pattern: "needle" },
                                id: "grep-long-output",
                                name: "grep",
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
                    toolName: "grep",
                });
                grepResult = messageText(lastMessage);
                return { content: [{ text: "PI_GREP_BOUNDS_VERIFIED", type: "text" }] };
            },
            modelId: "zai/glm-5",
            providerId: "bedrock",
        });
        running.add(gym);

        gym.terminal.type("Search for needle in the workspace.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("PI_GREP_BOUNDS_VERIFIED", 30_000);

        expect(Buffer.byteLength(grepResult, "utf8")).toBeLessThanOrEqual(50 * 1024);
        expect(grepResult).toContain("50KB limit reached");
        expect(grepResult).toContain("Some lines truncated to 500 chars");
        expect(grepResult).not.toContain("x".repeat(501));
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
