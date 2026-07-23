import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("hard abort during pending steering continuation", () => {
    it("keeps the interrupted run stopped while its descendants settle", async () => {
        let parentSessionId: string | undefined;
        const gym = await createGym({
            mode: "docker",
            inference(request) {
                const sessionId = request.options.sessionId;
                const lastMessage = request.context.messages.at(-1);
                const lastText = messageText(lastMessage?.content);

                if (sessionId?.endsWith(":title")) {
                    return { content: [{ text: "Hard abort regression", type: "text" }] };
                }

                const userTexts = request.context.messages.flatMap((message) =>
                    message.role === "user" ? [messageText(message.content)] : [],
                );
                if (userTexts.includes("Confirm the hard abort kept the run stopped.")) {
                    return { content: [{ text: "RECOVERED_AFTER_HARD_ABORT", type: "text" }] };
                }
                if (userTexts.includes("Pending direction that must not revive the run.")) {
                    return {
                        content: [{ text: "RUN_RESURRECTED_AFTER_HARD_ABORT", type: "text" }],
                    };
                }

                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                    return {
                        content: [
                            {
                                arguments: {
                                    fork_turns: "none",
                                    message: "Run the blocking child command.",
                                    task_name: "blocking_child",
                                },
                                id: "spawn-blocking-child",
                                name: "spawn_agent",
                                namespace: "collaboration",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (sessionId !== parentSessionId) {
                    if (lastText.includes("Run the blocking child command.")) {
                        return {
                            content: [
                                {
                                    arguments: {
                                        cmd: [
                                            "trap 'printf stopping > child-abort-state.txt; sleep 5; exit 143' TERM INT",
                                            "printf running > child-abort-state.txt",
                                            "while :; do sleep 1; done",
                                        ].join("; "),
                                        yield_time_ms: 30_000,
                                    },
                                    id: "blocking-child-command",
                                    name: "exec_command",
                                    type: "toolCall",
                                },
                            ],
                        };
                    }
                    return {
                        content: [{ text: "CHILD_SHOULD_NOT_FINISH", type: "text" }],
                        delayMs: 60_000,
                    };
                }

                return {
                    content: [{ text: "PARENT_WAITING_FOR_INTERRUPT", type: "text" }],
                    delayMs: 60_000,
                };
            },
            rows: 36,
        });
        running.add(gym);

        submit(gym, "Start delegated work and keep the parent running.");
        await expect
            .poll(() => gym.readFile("child-abort-state.txt"), { timeout: 30_000 })
            .toBe("running");
        await gym.terminal.waitForText("esc to interrupt", 30_000);

        submit(gym, "Pending direction that must not revive the run.");
        await gym.terminal.waitForText("Messages to be submitted after next tool call", 30_000);
        gym.terminal.press("escape");
        await gym.terminal.waitForText("Sending pending messages", 30_000);
        await expect
            .poll(() => gym.readFile("child-abort-state.txt"), { timeout: 30_000 })
            .toBe("stopping");

        submit(gym, "/abort");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Session interrupted") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "the hard abort to settle",
            30_000,
        );

        submit(gym, "Confirm the hard abort kept the run stopped.");
        const recovered = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("RECOVERED_AFTER_HARD_ABORT") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "the next independent turn to complete",
            30_000,
        );

        expect(recovered.text).not.toContain("RUN_RESURRECTED_AFTER_HARD_ABORT");
        expect(recovered.text).not.toContain("CHILD_SHOULD_NOT_FINISH");
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
