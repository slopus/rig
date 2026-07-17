import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Auto reviewer allows authorized host commands without extra prompts", () => {
    it("runs an approved command with home access and returns to Auto", async () => {
        const gym = await createGym({
            cols: 104,
            inference(request, callIndex) {
                if (request.context.systemPrompt?.includes("independent permission reviewer")) {
                    expect(callIndex).toBe(1);
                    return {
                        content: [
                            {
                                text: JSON.stringify({
                                    decision: "allow",
                                    reason: "The user explicitly requested this harmless developer check.",
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
                                    cmd: "printf 'auto host access works\\n' > /home/rig/auto-host.txt && cp /home/rig/auto-host.txt /workspace/auto-host-observed.txt",
                                    justification:
                                        "Write the home-directory marker the user requested.",
                                    sandbox_permissions: "require_escalated",
                                    workdir: "/workspace",
                                },
                                id: "authorized-auto-host-command",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                expect(callIndex).toBe(2);
                expect(request.context.messages.at(-1)).toMatchObject({
                    isError: false,
                    role: "toolResult",
                    toolName: "exec_command",
                });
                return { content: [{ text: "AUTO_HOST_COMMAND_COMPLETE", type: "text" }] };
            },
            permissionMode: "auto",
            rows: 30,
        });
        running.add(gym);

        submit(gym, "Write the requested harmless marker in my home directory.");
        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("AUTO_HOST_COMMAND_COMPLETE") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                footer(snapshot).includes("auto") &&
                snapshot.scroll.atBottom,
            "reviewer-approved host command",
            30_000,
        );

        await expect(gym.readFile("auto-host-observed.txt")).resolves.toBe(
            "auto host access works\n",
        );
        expect(completed.text).not.toContain("Approved automatically");
        expect(completed.text).not.toContain("Allow once");
        expect(completed.text).not.toContain("Waiting for approval");
        expect(footer(completed)).toContain("auto");
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function footer(snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>): string {
    return snapshot.rows.find((row) => row.includes("gym off")) ?? "";
}
