import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("workflow monitor", () => {
    it("opens a running workflow and updates the panel when it completes", async () => {
        let releaseChild: (() => void) | undefined;
        const childCanFinish = new Promise<void>((resolve) => {
            releaseChild = resolve;
        });
        let parentSessionId: string | undefined;
        let childStartedResolve: (() => void) | undefined;
        const childStarted = new Promise<void>((resolve) => {
            childStartedResolve = resolve;
        });
        const gym = await createGym({
            inference: async (request) => {
                const sessionId = request.options.sessionId;
                const lastMessage = request.context.messages.at(-1);
                const lastText =
                    typeof lastMessage?.content === "string"
                        ? lastMessage.content
                        : (lastMessage?.content ?? [])
                              .filter((block) => block.type === "text")
                              .map((block) => block.text)
                              .join("");

                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                    return {
                        content: [
                            {
                                arguments: {
                                    description: "Inspect one monitored target",
                                    name: "live-monitor",
                                    script: [
                                        'phase("Inspect")',
                                        'result = agent("Return MONITORED_CHILD_RESULT only.", {"label": "Monitor child"})',
                                        '{"result": result}',
                                    ].join("\n"),
                                },
                                id: "launch-monitored-workflow",
                                name: "workflow",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (lastText.includes("Return MONITORED_CHILD_RESULT only.")) {
                    expect(sessionId).not.toBe(parentSessionId);
                    childStartedResolve?.();
                    await childCanFinish;
                    return {
                        content: [{ text: "MONITORED_CHILD_RESULT", type: "text" }],
                    };
                }

                const launched = request.context.messages.some(
                    (message) => message.role === "toolResult" && message.toolName === "workflow",
                );
                if (launched && !lastText.includes("<workflow-notification>")) {
                    return { content: [{ text: "WORKFLOW_STARTED", type: "text" }] };
                }

                if (lastText.includes("<workflow-notification>")) {
                    return {
                        content: [{ text: "WORKFLOW_NOTIFICATION_ACK", type: "text" }],
                    };
                }

                throw new Error(`Unexpected inference request: ${lastText}`);
            },
        });
        running.add(gym);

        try {
            gym.terminal.type("Run a workflow I can monitor.");
            gym.terminal.press("enter");
            await childStarted;
            await gym.terminal.waitForText("WORKFLOW_STARTED", 30_000);
            await gym.terminal.waitForText("1 workflow running · /workflows to view", 30_000);

            gym.terminal.type("/workflows");
            gym.terminal.press("enter");

            const runningPanel = await gym.terminal.waitUntil(
                (snapshot) =>
                    snapshot.text.includes("Workflows") &&
                    snapshot.text.includes("Live monitor") &&
                    snapshot.text.includes("Running") &&
                    snapshot.text.includes("Inspect"),
                "running workflow monitor",
                30_000,
            );
            expect(runningPanel.text).toContain("1 agent");

            gym.terminal.press("enter");
            await gym.terminal.waitForText("Inspect one monitored target", 30_000);
            releaseChild?.();

            const completedPanel = await gym.terminal.waitUntil(
                (snapshot) =>
                    snapshot.text.includes("Completed") &&
                    snapshot.text.includes("MONITORED_CHILD_RESULT"),
                "completed workflow detail",
                30_000,
            );
            expect(completedPanel.text).not.toContain("1 workflow");

            gym.terminal.press("escape");
            gym.terminal.press("escape");
            await gym.terminal.waitForText("WORKFLOW_NOTIFICATION_ACK", 30_000);
        } finally {
            releaseChild?.();
        }
    }, 120_000);
});
