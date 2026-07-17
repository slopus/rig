import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";
import type { GymInferenceRequest } from "../../rig/sources/providers/gym-types.js";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Escape during a workflow-resurrected turn", () => {
    it("aborts the notification-driven turn and keeps the conversation usable", async () => {
        let releaseChild: (() => void) | undefined;
        const childCanFinish = new Promise<void>((resolve) => {
            releaseChild = resolve;
        });
        let childStartedResolve: (() => void) | undefined;
        const childStarted = new Promise<void>((resolve) => {
            childStartedResolve = resolve;
        });
        let parentSessionId: string | undefined;
        let notificationTurnStartedResolve: (() => void) | undefined;
        const notificationTurnStarted = new Promise<void>((resolve) => {
            notificationTurnStartedResolve = resolve;
        });
        const gym = await createGym({
            inference: async (request) => {
                const sessionId = request.options.sessionId;
                const lastText = textOfLastMessage(request);

                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                    return {
                        content: [
                            {
                                arguments: {
                                    description: "Trigger a later notification turn",
                                    name: "resurrect-session",
                                    script: [
                                        'result = agent("Return RESURRECT_CHILD_RESULT only.", {"label": "Resurrect child"})',
                                        '{"result": result}',
                                    ].join("\n"),
                                },
                                id: "launch-resurrect-workflow",
                                name: "workflow",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (lastText.includes("Return RESURRECT_CHILD_RESULT only.")) {
                    expect(sessionId).not.toBe(parentSessionId);
                    childStartedResolve?.();
                    await childCanFinish;
                    return { content: [{ text: "RESURRECT_CHILD_RESULT", type: "text" }] };
                }

                if (
                    sessionId === parentSessionId &&
                    toolResultText(request, "workflow") !== undefined
                ) {
                    return {
                        content: [{ text: "WORKFLOW_LAUNCHED_AND_TURN_EXITED", type: "text" }],
                    };
                }

                if (lastText.includes("<workflow-notification>")) {
                    notificationTurnStartedResolve?.();
                    return {
                        content: [
                            { text: "THIS_NOTIFICATION_TURN_SHOULD_BE_ABORTED", type: "text" },
                        ],
                        delayMs: 60_000,
                    };
                }

                if (lastText.includes("Confirm the session still responds after Escape.")) {
                    return {
                        content: [{ text: "SESSION_RESPONDS_AFTER_ESCAPE", type: "text" }],
                    };
                }

                throw new Error(`Unexpected inference request: ${lastText}`);
            },
        });
        running.add(gym);

        try {
            submit(gym, "Start a workflow, then finish this turn.");
            await childStarted;
            await gym.terminal.waitUntil(
                (snapshot) =>
                    snapshot.text.includes("WORKFLOW_LAUNCHED_AND_TURN_EXITED") &&
                    snapshot.text.includes("Ask Rig to do anything"),
                "idle session while its workflow continues",
                30_000,
            );

            releaseChild?.();
            await notificationTurnStarted;
            await gym.terminal.waitUntil(
                (snapshot) =>
                    snapshot.text.includes("Workflow Resurrect session completed.") &&
                    snapshot.text.includes("esc to interrupt"),
                "notification-driven agent turn",
                30_000,
            );

            gym.terminal.press("escape");
            const aborted = await gym.terminal.waitUntil(
                (snapshot) =>
                    snapshot.text.includes("Session interrupted") &&
                    snapshot.text.includes("Ask Rig to do anything"),
                "Escape aborting the workflow-resurrected turn",
                30_000,
            );
            expect(aborted.text).not.toContain("THIS_NOTIFICATION_TURN_SHOULD_BE_ABORTED");

            submit(gym, "Confirm the session still responds after Escape.");
            const recovered = await gym.terminal.waitUntil(
                (snapshot) =>
                    snapshot.text.includes("SESSION_RESPONDS_AFTER_ESCAPE") &&
                    snapshot.text.includes("Ask Rig to do anything"),
                "conversation after aborting the notification turn",
                30_000,
            );
            expect(recovered.text).toContain("SESSION_RESPONDS_AFTER_ESCAPE");
        } finally {
            releaseChild?.();
        }
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function textOfLastMessage(request: GymInferenceRequest): string {
    const message = request.context.messages.at(-1);
    if (message === undefined) return "";
    if (typeof message.content === "string") return message.content;
    return message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
}

function toolResultText(request: GymInferenceRequest, toolName: string): string | undefined {
    const result = [...request.context.messages]
        .reverse()
        .find((message) => message.role === "toolResult" && message.toolName === toolName);
    if (result === undefined || result.role !== "toolResult") return undefined;
    if (typeof result.content === "string") return result.content;
    return result.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
}
