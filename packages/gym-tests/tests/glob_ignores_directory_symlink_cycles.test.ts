import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("glob directory symlink handling", () => {
    it("returns workspace files without following a directory symlink cycle", async () => {
        let globResult = "";
        const gym = await createGym({
            files: { "src/direct.ts": "direct\n" },
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { command: "ln -s .. src/loop" },
                                id: "create-directory-cycle",
                                name: "Bash",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (callIndex === 1) {
                    expect(request.context.messages.at(-1)).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "Bash",
                    });
                    return {
                        content: [
                            {
                                arguments: { pattern: "**/*.ts" },
                                id: "glob-directory-cycle",
                                name: "Glob",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(2);
                const lastMessage = request.context.messages.at(-1);
                expect(lastMessage).toMatchObject({
                    isError: false,
                    role: "toolResult",
                    toolName: "Glob",
                });
                globResult = messageText(lastMessage);
                return { content: [{ text: "SYMLINK_CYCLE_IGNORED", type: "text" }] };
            },
            modelId: "anthropic/sonnet-4-6",
            providerId: "claude",
            providerOverrides: ["claude"],
        });
        running.add(gym);

        gym.terminal.type("Create the symlink and find every TypeScript file.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("SYMLINK_CYCLE_IGNORED", 30_000);

        expect(globResult).toBe("/workspace/src/direct.ts");
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
