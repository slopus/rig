import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Auto reviewer allows explicit Git hook changes", () => {
    it("reviews and applies the requested hook without requiring Full access mode", async () => {
        const gym = await createGym({
            cols: 104,
            files: {
                ".git/HEAD": "ref: refs/heads/main\n",
                ".git/hooks/.keep": "fixture\n",
            },
            inference(request, callIndex) {
                if (request.context.systemPrompt?.includes("independent permission reviewer")) {
                    expect(messageText(request.context.messages.at(-1))).toContain(
                        ".git/hooks/pre-commit",
                    );
                    return {
                        content: [
                            {
                                text: JSON.stringify({
                                    decision: "allow",
                                    reason: "The user explicitly requested this local pre-commit hook.",
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
                                    patch: [
                                        "*** Begin Patch",
                                        "*** Add File: .git/hooks/pre-commit",
                                        "+#!/bin/sh",
                                        "+pnpm lint",
                                        "*** End Patch",
                                    ].join("\n"),
                                    workdir: "/workspace",
                                },
                                id: "add-requested-pre-commit-hook",
                                name: "apply_patch",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                expect(callIndex).toBe(2);
                expect(request.context.messages.at(-1)).toMatchObject({
                    isError: false,
                    role: "toolResult",
                    toolName: "apply_patch",
                });
                return { content: [{ text: "AUTO_GIT_HOOK_ADDED", type: "text" }] };
            },
            permissionMode: "auto",
            rows: 30,
        });
        running.add(gym);

        submit(gym, "Add a pre-commit hook that runs pnpm lint.");
        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("AUTO_GIT_HOOK_ADDED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "explicit Git hook change in Auto",
            30_000,
        );

        await expect(gym.readFile(".git/hooks/pre-commit")).resolves.toBe("#!/bin/sh\npnpm lint");
        expect(completed.text).not.toContain("Approved automatically");
        expect(completed.text).not.toContain("full access");
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
