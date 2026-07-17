import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Pi find results", () => {
    it("returns relative paths without files excluded by .gitignore", async () => {
        let findResult = "";
        const gym = await createGym({
            environment: {
                AWS_BEARER_TOKEN_BEDROCK: "gym-placeholder-token",
                RIG_GYM_PROVIDER_OVERRIDES: "bedrock",
            },
            files: {
                ".gitignore": "ignored/\n",
                "ignored/secret.ts": "export const secret = true;\n",
                "src/visible.ts": "export const visible = true;\n",
            },
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { pattern: "**/*.ts" },
                                id: "find-visible-typescript",
                                name: "find",
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
                    toolName: "find",
                });
                findResult = messageText(lastMessage);
                return { content: [{ text: "PI_FIND_CONTRACT_VERIFIED", type: "text" }] };
            },
            modelId: "zai/glm-5",
            providerId: "bedrock",
        });
        running.add(gym);

        gym.terminal.type("Find every TypeScript file in the workspace.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("PI_FIND_CONTRACT_VERIFIED", 30_000);

        expect(findResult).toBe("src/visible.ts");
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
