import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("directory globstar matching", () => {
    it("returns files directly below the directory and in nested directories", async () => {
        let globResult = "";
        const gym = await createGym({
            files: {
                "src/direct.ts": "direct\n",
                "src/nested/child.ts": "nested\n",
            },
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { pattern: "src/**/*.ts" },
                                id: "find-direct-and-nested-typescript",
                                name: "Glob",
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
                    toolName: "Glob",
                });
                globResult = messageText(lastMessage);
                return { content: [{ text: "DIRECT_GLOBSTAR_VERIFIED", type: "text" }] };
            },
            modelId: "anthropic/sonnet-4-6",
            providerId: "claude",
            providerOverrides: ["claude"],
        });
        running.add(gym);

        gym.terminal.type("Find every TypeScript file below src.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("DIRECT_GLOBSTAR_VERIFIED", 30_000);

        expect(globResult.split("\n").sort()).toEqual([
            "/workspace/src/direct.ts",
            "/workspace/src/nested/child.ts",
        ]);
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
