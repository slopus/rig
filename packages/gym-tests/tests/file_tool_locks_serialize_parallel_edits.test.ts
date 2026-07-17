import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("file tool locks", () => {
    it("serializes parallel edits to the same file so neither change is lost", async () => {
        const gym = await createGym({
            files: { "shared.txt": "alpha\nbeta\n" },
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { file_path: "/workspace/shared.txt" },
                                id: "read-shared-file",
                                name: "Read",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (callIndex === 1) {
                    expect(request.context.messages.at(-1)).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "Read",
                    });
                    return {
                        content: [
                            {
                                arguments: {
                                    file_path: "/workspace/shared.txt",
                                    new_string: "ALPHA",
                                    old_string: "alpha",
                                },
                                id: "edit-alpha",
                                name: "Edit",
                                type: "toolCall",
                            },
                            {
                                arguments: {
                                    file_path: "/workspace/shared.txt",
                                    new_string: "BETA",
                                    old_string: "beta",
                                },
                                id: "edit-beta",
                                name: "Edit",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(2);
                expect(request.context.messages.slice(-2)).toMatchObject([
                    { isError: false, role: "toolResult", toolName: "Edit" },
                    { isError: false, role: "toolResult", toolName: "Edit" },
                ]);
                return { content: [{ text: "PARALLEL_FILE_LOCKS_VERIFIED", type: "text" }] };
            },
            modelId: "anthropic/sonnet-4-6",
            providerId: "claude",
            providerOverrides: ["claude"],
        });
        running.add(gym);

        gym.terminal.type("Read the shared file, then make both independent edits in parallel.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("PARALLEL_FILE_LOCKS_VERIFIED", 30_000);

        await expect(gym.readFile("shared.txt")).resolves.toBe("ALPHA\nBETA\n");
    }, 120_000);
});
