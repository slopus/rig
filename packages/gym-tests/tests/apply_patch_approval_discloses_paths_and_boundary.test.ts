import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("apply_patch approval disclosure", () => {
    it("shows affected paths and the unrestricted filesystem boundary before denial", async () => {
        const path = "/home/rig/apply-patch-disclosure.txt";
        const gym = await createGym({
            cols: 112,
            inference(request, callIndex) {
                const systemPrompt = request.context.systemPrompt ?? "";
                if (systemPrompt.includes("independent permission reviewer")) {
                    expect(callIndex).toBe(1);
                    return {
                        content: [
                            {
                                text: JSON.stringify({
                                    decision: "ask",
                                    reason: "This patch writes outside the workspace.",
                                    risk: "high",
                                    user_authorization: "low",
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
                                    patch: [
                                        "*** Begin Patch",
                                        `*** Add File: ${path}`,
                                        "+must not be written",
                                        "*** End Patch",
                                    ].join("\n"),
                                },
                                id: "apply-patch-disclosure-call",
                                name: "apply_patch",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(2);
                expect(request.context.messages.at(-1)).toMatchObject({
                    isError: true,
                    role: "toolResult",
                    toolName: "apply_patch",
                });
                return { content: [{ text: "PATCH_DISCLOSURE_DENIED", type: "text" }] };
            },
            rows: 36,
        });
        running.add(gym);

        submit(gym, "/permissions");
        await gym.terminal.waitForText("Choose Permissions");
        gym.terminal.press("up");
        gym.terminal.press("up");
        gym.terminal.press("up");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Permissions changed to Auto.");

        submit(gym, "Ask before applying the proposed patch outside the workspace.");
        const approval = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Allow once") &&
                snapshot.text.includes("Deny") &&
                snapshot.scroll.atBottom,
            "the apply_patch approval panel",
            30_000,
        );
        const normalized = approval.text.replace(/\s+/gu, " ");
        expect(normalized).toContain(path);
        expect(normalized).toContain('Working directory: "/workspace"');
        expect(normalized.toLowerCase()).toContain(
            "unrestricted filesystem access outside the workspace sandbox",
        );
        await expectPathToBeMissing(gym, path);

        gym.terminal.press("down");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("PATCH_DISCLOSURE_DENIED", 30_000);
        await expectPathToBeMissing(gym, path);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

async function expectPathToBeMissing(gym: Gym, path: string): Promise<void> {
    const result = await gym.runInContainer("test", ["!", "-e", path]);
    expect(result).toEqual({ stderr: "", stdout: "" });
}
