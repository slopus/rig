import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("successful Auto permission reviews", () => {
    it("runs the tool without adding approval details to its history", async () => {
        const gym = await createGym({
            cols: 132,
            inference(request, callIndex) {
                if (request.context.systemPrompt?.includes("independent permission reviewer")) {
                    return {
                        content: [
                            {
                                text: JSON.stringify({
                                    decision: "allow",
                                    reason: "The user explicitly authorized this harmless home-directory check.",
                                    risk: "low",
                                    user_authorization: "high",
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
                                    cmd: "printf 'INLINE_APPROVAL_MARKER\\n' > /home/rig/inline-approval.txt",
                                    justification:
                                        "Create the home-directory marker the user requested.",
                                    sandbox_permissions: "require_escalated",
                                },
                                id: "inline-auto-approval",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                return {
                    content: [{ text: "INLINE_AUTO_APPROVAL_COMPLETE", type: "text" }],
                };
            },
            permissionMode: "auto",
            rows: 32,
        });
        running.add(gym);

        submit(gym, "Create the harmless marker in my home directory.");
        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("INLINE_AUTO_APPROVAL_COMPLETE") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "completed automatically approved tool",
            30_000,
        );

        const toolRow = completed.rows.findIndex((row) => row.includes("INLINE_APPROVAL_MARKER"));
        expect(toolRow).toBeGreaterThanOrEqual(0);
        expect(completed.text).not.toContain("Approved automatically");
        expect(completed.text).not.toContain("Risk: low");
        expect(completed.text).not.toContain("User authorization: high");
        expect(completed.text).not.toContain(
            "The user explicitly authorized this harmless home-directory check.",
        );
        expect(completed.rows.some((row) => row.includes("Auto permission"))).toBe(false);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}
