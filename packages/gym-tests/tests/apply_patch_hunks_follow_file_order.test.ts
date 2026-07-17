import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("apply_patch hunk ordering", () => {
    it("keeps an append at the end when a later hunk edits an earlier line", async () => {
        const patch = [
            "*** Begin Patch",
            "*** Update File: order.txt",
            "@@",
            "+X",
            "@@",
            "-A",
            "+A1",
            "+A2",
            "*** End Patch",
        ].join("\n");
        const gym = await createGym({
            files: { "order.txt": "A\nB\nC\n" },
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { patch, workdir: "/workspace" },
                                id: "apply-position-ordered-hunks",
                                name: "apply_patch",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(1);
                expect(request.context.messages.at(-1)).toMatchObject({
                    isError: false,
                    role: "toolResult",
                    toolName: "apply_patch",
                });
                return { content: [{ text: "PATCH_HUNK_ORDER_VERIFIED", type: "text" }] };
            },
        });
        running.add(gym);

        gym.terminal.type("Apply the requested changes in the supplied hunk order.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("PATCH_HUNK_ORDER_VERIFIED", 30_000);

        await expect(gym.readFile("order.txt")).resolves.toBe("A1\nA2\nB\nC\nX\n");
    }, 120_000);
});
