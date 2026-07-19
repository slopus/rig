import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Workspace write uses the Codex Linux sandbox", () => {
    it("reads Git config from home while blocking home and repository metadata writes", async () => {
        const gym = await createGym({
            cols: 100,
            mode: "docker",
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: [
                                        "git init --quiet",
                                        "printf 'ignored-by-global-config.txt\\n' > /home/rig/.gitignore_global",
                                        "git config --global core.excludesfile /home/rig/.gitignore_global",
                                        "touch ignored-by-global-config.txt",
                                    ].join(" && "),
                                },
                                id: "seed-standalone-repository",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 1) {
                    expect(messageText(lastMessage)).not.toContain("Permission denied");
                    return { content: [{ text: "GIT_FIXTURE_READY", type: "text" }] };
                }

                if (callIndex === 2) {
                    expect(messageText(lastMessage)).toContain("Check the standalone repository");
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: "mkdir -p .agents .codex; printf poisoned > .agents/instructions.md; printf poisoned > .codex/config.toml; sleep 0.05",
                                },
                                id: "attempt-protected-metadata-creation",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 3) {
                    expect(lastMessage).toMatchObject({
                        isError: true,
                        role: "toolResult",
                        toolName: "exec_command",
                    });
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: [
                                        "test -z \"$(git status --short)\" && printf 'GIT_STATUS_OK\\n' || printf 'GIT_STATUS_DIRTY\\n'",
                                        "test ! -e .agents && test ! -e .codex && printf 'MISSING_METADATA_PROTECTED\\n' || printf 'MISSING_METADATA_ESCAPED\\n'",
                                        "if printf blocked > /home/rig/blocked.txt; then printf 'HOME_WRITE_ESCAPED\\n'; else printf 'HOME_WRITE_BLOCKED\\n'; fi",
                                        "if printf blocked > .git/config; then printf 'GIT_WRITE_ESCAPED\\n'; else printf 'GIT_WRITE_BLOCKED\\n'; fi",
                                    ].join("; "),
                                },
                                id: "verify-codex-linux-boundary",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 4) {
                    const result = messageText(lastMessage);
                    const passed =
                        result.includes("GIT_STATUS_OK") &&
                        result.includes("MISSING_METADATA_PROTECTED") &&
                        result.includes("HOME_WRITE_BLOCKED") &&
                        result.includes("GIT_WRITE_BLOCKED") &&
                        !result.includes("MISSING_METADATA_ESCAPED") &&
                        !result.includes("HOME_WRITE_ESCAPED") &&
                        !result.includes("GIT_WRITE_ESCAPED");
                    return {
                        content: [
                            {
                                text: passed
                                    ? "CODEX_LINUX_SANDBOX_OK"
                                    : "CODEX_LINUX_SANDBOX_FAILED",
                                type: "text",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(5);
                return { content: [{ text: "LINUX_SANDBOX_FOLLOW_UP_OK", type: "text" }] };
            },
            rows: 28,
        });
        running.add(gym);

        submit(gym, "Create a standalone Git fixture for the sandbox regression.");
        await gym.terminal.waitForText("GIT_FIXTURE_READY", 30_000);

        submit(gym, "/permissions");
        await gym.terminal.waitForText("Choose Permissions");
        gym.terminal.press("up");
        gym.terminal.press("up");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Permissions changed to Workspace write.");

        submit(gym, "Check the standalone repository and restricted write boundary.");
        const outcome = await gym.terminal.waitUntil(
            (snapshot) =>
                (snapshot.text.includes("CODEX_LINUX_SANDBOX_OK") ||
                    snapshot.text.includes("CODEX_LINUX_SANDBOX_FAILED")) &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "the Codex Linux sandbox outcome",
            30_000,
        );
        expect(outcome.text).toContain("CODEX_LINUX_SANDBOX_OK");
        expect(outcome.text).not.toContain("CODEX_LINUX_SANDBOX_FAILED");
        await expect(gym.readFile("ignored-by-global-config.txt")).resolves.toBe("");

        submit(gym, "Confirm the restricted session remains usable.");
        await gym.terminal.waitForText("LINUX_SANDBOX_FOLLOW_UP_OK", 30_000);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
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
