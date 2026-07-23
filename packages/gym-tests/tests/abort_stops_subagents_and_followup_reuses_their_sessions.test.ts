import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("aborting delegated work and reusing its session", () => {
    it("stops the child process and accepts a later follow-up in the same child session", async () => {
        let initialRequestSeen = false;
        const gym = await createGym({
            mode: "docker",
            inference(request) {
                const sessionId = request.options.sessionId;
                if (sessionId?.endsWith(":title")) {
                    return { content: [{ text: "Reusable stopped subagent", type: "text" }] };
                }

                const userTexts = request.context.messages.flatMap((message) =>
                    message.role === "user" ? [messageText(message.content)] : [],
                );
                const lastText = userTexts.at(-1) ?? "";
                if (!initialRequestSeen) {
                    initialRequestSeen = true;
                    return {
                        content: [
                            {
                                arguments: {
                                    fork_turns: "none",
                                    message: "Start the child process and wait.",
                                    task_name: "reusable_child",
                                },
                                id: "spawn-reusable-child",
                                name: "spawn_agent",
                                namespace: "collaboration",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                const isChild = userTexts.some(
                    (text) =>
                        text.includes("Start the child process and wait.") ||
                        text.includes("Use your retained context"),
                );
                if (isChild) {
                    if (lastText.includes("Start the child process and wait.")) {
                        return {
                            content: [
                                {
                                    arguments: {
                                        cmd: [
                                            "trap 'printf stopped > child-state.txt; exit 143' TERM INT",
                                            "printf running > child-state.txt",
                                            "while :; do sleep 1; done",
                                        ].join("; "),
                                        yield_time_ms: 30_000,
                                    },
                                    id: "run-child-process",
                                    name: "exec_command",
                                    type: "toolCall",
                                },
                            ],
                        };
                    }
                    if (lastText.includes("Use your retained context")) {
                        expect(userTexts).toContain("Start the child process and wait.");
                        return { content: [{ text: "CHILD_SESSION_REUSED", type: "text" }] };
                    }
                    return {
                        content: [{ text: "CHILD_SHOULD_NOT_FINISH_FIRST_TURN", type: "text" }],
                    };
                }

                const lastMessage = request.context.messages.at(-1);
                if (
                    lastMessage?.role === "toolResult" &&
                    lastMessage.toolName === "followup_task"
                ) {
                    return {
                        content: [{ text: "FOLLOWUP_SENT_TO_REUSED_CHILD", type: "text" }],
                    };
                }
                if (lastText.includes("<subagent-notification>")) {
                    return { content: [{ text: "REUSED_CHILD_FINISHED", type: "text" }] };
                }
                if (lastText.includes("Reuse the stopped child")) {
                    return {
                        content: [
                            {
                                arguments: {
                                    message:
                                        "Use your retained context and report that you resumed.",
                                    target: "reusable_child",
                                },
                                id: "follow-up-reusable-child",
                                name: "followup_task",
                                namespace: "collaboration",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                return {
                    content: [{ text: "PARENT_SHOULD_NOT_FINISH_FIRST_TURN", type: "text" }],
                    delayMs: 60_000,
                };
            },
            rows: 36,
        });
        running.add(gym);

        submit(gym, "Start delegated work and keep waiting.");
        await expect
            .poll(() => gym.readFile("child-state.txt"), { timeout: 30_000 })
            .toBe("running");

        submit(gym, "/abort");
        await expect
            .poll(() => gym.readFile("child-state.txt"), { timeout: 30_000 })
            .toBe("stopped");
        const stopped = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Session interrupted") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "the parent and child abort to settle",
            30_000,
        );
        expect(stopped.text).not.toContain("suspended");

        submit(gym, "Reuse the stopped child for a follow-up.");
        const reused = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("REUSED_CHILD_FINISHED") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "the original child session to finish its follow-up",
            30_000,
        );

        expect(reused.text).not.toContain("CHILD_SHOULD_NOT_FINISH_FIRST_TURN");
        expect(reused.text).not.toContain("PARENT_SHOULD_NOT_FINISH_FIRST_TURN");
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function messageText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .filter(
            (block): block is { text: string } =>
                typeof block === "object" &&
                block !== null &&
                "text" in block &&
                typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("\n");
}
