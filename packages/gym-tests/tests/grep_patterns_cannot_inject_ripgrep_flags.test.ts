import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Grep patterns are always search text", () => {
    it("searches dash-prefixed patterns without executing ripgrep flags", async () => {
        let injectedPatternResult = "";
        let preprocessorCheckResult = "";
        let arrowPatternResult = "";
        const gym = await createGym({
            files: {
                "arrow.txt": "left -> right\n",
                "preprocessor.sh": {
                    content: "#!/bin/sh\nprintf 'executed\\n' > /home/rig/preprocessor-ran.txt\n",
                    mode: 0o755,
                },
            },
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);
                const resultText = messageText(lastMessage);
                if (callIndex === 0) {
                    return grepCall("injected-ripgrep-flag", "--pre=/workspace/preprocessor.sh");
                }
                if (callIndex === 1) {
                    expect(lastMessage).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "Grep",
                    });
                    injectedPatternResult = resultText;
                    return {
                        content: [
                            {
                                arguments: {
                                    command:
                                        "if test -f /home/rig/preprocessor-ran.txt; then printf executed; else printf safe; fi",
                                },
                                id: "check-preprocessor-boundary",
                                name: "Bash",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (callIndex === 2) {
                    expect(lastMessage).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "Bash",
                    });
                    preprocessorCheckResult = resultText;
                    return grepCall("dash-prefixed-arrow", "->");
                }

                expect(callIndex).toBe(3);
                expect(lastMessage).toMatchObject({
                    isError: false,
                    role: "toolResult",
                    toolName: "Grep",
                });
                arrowPatternResult = resultText;
                return { content: [{ text: "DASH_PREFIXED_GREP_VERIFIED", type: "text" }] };
            },
            modelId: "anthropic/sonnet-4-6",
            providerId: "claude",
            providerOverrides: ["claude"],
        });
        running.add(gym);

        gym.terminal.type("Search for both requested literal patterns.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("DASH_PREFIXED_GREP_VERIFIED", 30_000);

        expect(injectedPatternResult).toBe("No matches found");
        expect(preprocessorCheckResult).toContain("safe");
        expect(arrowPatternResult).toContain("left -> right");
    }, 120_000);
});

function grepCall(id: string, pattern: string) {
    return {
        content: [
            {
                arguments: {
                    output_mode: "content",
                    path: "/workspace/arrow.txt",
                    pattern,
                },
                id,
                name: "Grep",
                type: "toolCall" as const,
            },
        ],
    };
}

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
