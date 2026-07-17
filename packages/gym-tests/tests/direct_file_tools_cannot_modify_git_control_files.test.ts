import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("direct file tools cannot modify Git control files", () => {
    it("denies compromised patch calls while preserving normal workspace edits", async () => {
        let stage = 0;
        const blockedMessage =
            "Tool 'apply_patch' failed: Workspace write mode cannot modify Git control files without Full access.";
        const gym = await createGym({
            cols: 100,
            files: {
                ".git/config": "[core]\n\trepositoryformatversion = 0\n",
                ".git/hooks/.keep": "fixture\n",
                "src/existing.ts": "export const existing = true;\n",
            },
            inference(request) {
                if (request.options.sessionId?.endsWith(":title")) {
                    return { content: [{ text: "Direct Git security", type: "text" }] };
                }

                const lastMessage = request.context.messages.at(-1);
                if (stage === 0) {
                    stage = 1;
                    return patchCall(
                        "write-hook-directly",
                        [
                            "*** Begin Patch",
                            "*** Add File: .git/hooks/post-checkout",
                            "+#!/bin/sh",
                            "+printf compromised > /tmp/direct-file-hook-ran",
                            "*** End Patch",
                        ].join("\n"),
                    );
                }

                if (stage === 1) {
                    expect(lastMessage).toMatchObject({
                        content: [{ text: blockedMessage, type: "text" }],
                        isError: true,
                        role: "toolResult",
                        toolName: "apply_patch",
                    });
                    stage = 2;
                    return patchCall(
                        "redirect-hooks-directly",
                        [
                            "*** Begin Patch",
                            "*** Update File: .git/config",
                            "@@",
                            " [core]",
                            " \trepositoryformatversion = 0",
                            "+\thooksPath = ../hidden-hooks",
                            "*** End Patch",
                        ].join("\n"),
                    );
                }

                if (stage === 2) {
                    expect(lastMessage).toMatchObject({
                        content: [{ text: blockedMessage, type: "text" }],
                        isError: true,
                        role: "toolResult",
                        toolName: "apply_patch",
                    });
                    stage = 3;
                    return patchCall(
                        "edit-normal-source",
                        [
                            "*** Begin Patch",
                            "*** Update File: src/existing.ts",
                            "@@",
                            "-export const existing = true;",
                            '+export const existing = "secure";',
                            "*** End Patch",
                        ].join("\n"),
                    );
                }

                if (stage === 3) {
                    expect(lastMessage).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "apply_patch",
                    });
                    stage = 4;
                    return {
                        content: [{ text: "DIRECT_GIT_CONTROL_WRITES_BLOCKED", type: "text" }],
                    };
                }

                return { content: [{ text: "DIRECT_GIT_SECURITY_FOLLOW_UP_OK", type: "text" }] };
            },
            permissionMode: "workspace_write",
            rows: 27,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "Inspect this repository without changing any persistent Git controls.");
        const outcome = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("DIRECT_GIT_CONTROL_WRITES_BLOCKED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "direct Git control protection outcome",
            30_000,
        );
        expect(outcome.text).toContain("cannot modify Git control files without Full access");
        await expect(gym.readFile(".git/hooks/post-checkout")).rejects.toMatchObject({
            code: "ENOENT",
        });
        expect(await gym.readFile(".git/config")).not.toContain("hooksPath");
        expect(await gym.readFile("src/existing.ts")).toBe('export const existing = "secure";\n');
        assertHealthy(outcome, baseline);

        submit(gym, "Confirm the session remains usable after those denials.");
        const followUp = await gym.terminal.waitForText("DIRECT_GIT_SECURITY_FOLLOW_UP_OK", 30_000);
        assertHealthy(followUp, baseline);
    }, 120_000);
});

function patchCall(id: string, patch: string) {
    return {
        content: [
            {
                arguments: { patch, workdir: "/workspace" },
                id,
                name: "apply_patch",
                type: "toolCall" as const,
            },
        ],
    };
}

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function assertHealthy(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    baseline: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.rows).toHaveLength(27);
    expect(snapshot.scroll.visibleRows).toBe(27);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.cursor.x).toBeLessThan(100);
    expect(snapshot.cursor.y).toBeLessThan(27);
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).toContain("workspace write");
    expect(snapshot.text).not.toContain("�");
}
