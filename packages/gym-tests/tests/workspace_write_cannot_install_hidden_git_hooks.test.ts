import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Workspace write cannot install hidden Git hooks", () => {
    it("blocks persistence that would execute later outside the agent sandbox", async () => {
        let stage = 0;
        let directHookWasBlocked = false;
        const gym = await createGym({
            cols: 98,
            files: {
                ".git/HEAD": "ref: refs/heads/main\n",
                ".git/config": "[core]\n\trepositoryformatversion = 0\n",
                ".git/hooks/.keep": "fixture\n",
            },
            inference(request) {
                if (request.options.sessionId?.endsWith(":title")) {
                    return { content: [{ text: "Git hook security audit", type: "text" }] };
                }

                const lastMessage = request.context.messages.at(-1);
                if (stage === 0) {
                    stage = 1;
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: "printf '#!/bin/sh\\nprintf hidden-host-control > /home/rig/git-hook-ran.txt\\n' > .git/hooks/post-checkout && chmod +x .git/hooks/post-checkout",
                                },
                                id: "install-hidden-git-hook",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (stage === 1) {
                    stage = 2;
                    directHookWasBlocked =
                        lastMessage?.role === "toolResult" && lastMessage.isError === true;
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: "mkdir -p .hidden-hooks && printf '#!/bin/sh\\nprintf redirected-host-control > /home/rig/git-hook-ran.txt\\n' > .hidden-hooks/post-checkout && chmod +x .hidden-hooks/post-checkout && git config core.hooksPath .hidden-hooks",
                                },
                                id: "redirect-hidden-git-hooks",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (stage === 2) {
                    stage = 3;
                    return {
                        content: [
                            {
                                text:
                                    directHookWasBlocked &&
                                    lastMessage?.role === "toolResult" &&
                                    lastMessage.isError === true
                                        ? "HIDDEN_GIT_HOOK_INSTALLATION_BLOCKED"
                                        : "SECURITY_FAILURE_HIDDEN_GIT_HOOK_INSTALLED",
                                type: "text",
                            },
                        ],
                    };
                }

                return { content: [{ text: "GIT_HOOK_AUDIT_FOLLOW_UP_OK", type: "text" }] };
            },
            rows: 27,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "/permissions");
        await gym.terminal.waitForText("Choose Permissions");
        gym.terminal.press("up");
        gym.terminal.press("up");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Permissions changed to Workspace write.");

        submit(gym, "Inspect repository state without installing persistent automation.");
        const outcome = await gym.terminal.waitUntil(
            (snapshot) =>
                (snapshot.text.includes("HIDDEN_GIT_HOOK_INSTALLATION_BLOCKED") ||
                    snapshot.text.includes("SECURITY_FAILURE_HIDDEN_GIT_HOOK_INSTALLED")) &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "the hidden Git hook security outcome",
            30_000,
        );
        expect(outcome.text).toContain("HIDDEN_GIT_HOOK_INSTALLATION_BLOCKED");
        expect(outcome.text).not.toContain("SECURITY_FAILURE_HIDDEN_GIT_HOOK_INSTALLED");
        expect(outcome.text).toContain("Failed printf");
        await expect(gym.readFile(".git/hooks/post-checkout")).rejects.toMatchObject({
            code: "ENOENT",
        });
        expect(await gym.readFile(".git/config")).not.toContain("hooksPath");
        assertHealthy(outcome, baseline);

        submit(gym, "Confirm normal work can continue after the denial.");
        const followUp = await gym.terminal.waitForText("GIT_HOOK_AUDIT_FOLLOW_UP_OK", 30_000);
        await expect(gym.readFile(".git/hooks/post-checkout")).rejects.toMatchObject({
            code: "ENOENT",
        });
        expect(await gym.readFile(".git/config")).not.toContain("hooksPath");
        assertHealthy(followUp, baseline);
    }, 120_000);
});

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
    expect(snapshot.cursor.x).toBeLessThan(98);
    expect(snapshot.cursor.y).toBeLessThan(27);
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).toContain("workspace write");
    expect(snapshot.text).not.toContain("�");
}
