import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Codex Code Mode nested tool execution", () => {
    it("runs an exec program whose nested shell tool changes the workspace", async () => {
        const gym = await createGym({
            homeFiles: {
                ".codex/auth.json": JSON.stringify({
                    auth_mode: "chatgpt",
                    tokens: {
                        access_token: "gym-codex-token",
                        account_id: "gym-account",
                    },
                }),
            },
            inference(request, callIndex) {
                if (callIndex === 0) {
                    const toolNames = request.context.tools?.map((tool) => tool.name) ?? [];
                    if (!toolNames.includes("exec")) {
                        throw new Error(
                            `Code Mode tools were not selected: ${toolNames.join(", ")}`,
                        );
                    }
                    expect(toolNames).toEqual([
                        "exec",
                        "wait",
                        "request_user_input",
                        "collaboration",
                        "rig",
                    ]);
                    return {
                        content: [
                            {
                                type: "toolCall",
                                id: "call-code-mode",
                                kind: "custom",
                                name: "exec",
                                arguments: {
                                    input: String.raw`const result = await tools.exec_command({ cmd: "printf 'nested tool worked\\n' > codemode-result.txt" });
text(result.output);`,
                                },
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(1);
                expect(request.context.messages.at(-1)).toMatchObject({
                    role: "toolResult",
                    toolName: "exec",
                    isError: false,
                });
                return {
                    content: [{ type: "text", text: "CODE_MODE_NESTED_TOOL_COMPLETE" }],
                };
            },
            modelId: "openai/gpt-5.6-sol",
            providerId: "codex",
            providerOverrides: ["codex"],
        });
        running.add(gym);

        gym.terminal.type("Create the requested file through Code Mode.");
        gym.terminal.press("enter");

        const screen = await gym.terminal.waitForText("CODE_MODE_NESTED_TOOL_COMPLETE", 30_000);
        expect(screen.text).toContain("CODE_MODE_NESTED_TOOL_COMPLETE");
        await expect(gym.readFile("codemode-result.txt")).resolves.toBe("nested tool worked\n");
    }, 60_000);
});
