import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";
import type { GymInferenceRequest } from "../../rig/sources/providers/gym-types.js";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("cancelling a workflow wait", () => {
    it("stops only the wait, informs the agent, and later delivers the workflow result", async () => {
        let releaseChild: (() => void) | undefined;
        const childCanFinish = new Promise<void>((resolve) => {
            releaseChild = resolve;
        });
        let parentSessionId: string | undefined;
        let childStartedResolve: (() => void) | undefined;
        const childStarted = new Promise<void>((resolve) => {
            childStartedResolve = resolve;
        });
        let sawAbortedWaitResult = false;
        let sawCompletionNotification = false;
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
                                    description: "Complete even if waiting is cancelled",
                                    name: "surviving-workflow",
                                    script: [
                                        'phase("Survive wait cancellation")',
                                        'result = agent("Return SURVIVING_WORKFLOW_RESULT only.", {"label": "Surviving child"})',
                                        '{"result": result}',
                                    ].join("\n"),
                                },
                                id: "launch-surviving-workflow",
                                name: "workflow",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (lastText.includes("Return SURVIVING_WORKFLOW_RESULT only.")) {
                    expect(sessionId).not.toBe(parentSessionId);
                    childStartedResolve?.();
                    await childCanFinish;
                    return {
                        content: [{ text: "SURVIVING_WORKFLOW_RESULT", type: "text" }],
                    };
                }

                const launchResult = toolResultText(request, "workflow");
                if (sessionId === parentSessionId && launchResult !== undefined) {
                    const { runId } = JSON.parse(launchResult) as { runId: string };
                    return {
                        content: [
                            {
                                arguments: { run_id: runId },
                                id: "cancel-this-workflow-wait",
                                name: "wait_for_workflow",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (lastText.includes("Confirm what happened to the workflow wait.")) {
                    const waitResult = toolResultText(request, "wait_for_workflow");
                    expect(waitResult).toContain("wait was cancelled by the user");
                    expect(waitResult).toContain("workflow is still running");
                    sawAbortedWaitResult = true;
                    return {
                        content: [{ text: "WAIT_ABORTED_WORKFLOW_CONTINUES", type: "text" }],
                    };
                }

                if (lastText.includes("<workflow-notification>")) {
                    expect(lastText).toContain("Status: completed");
                    expect(lastText).toContain("SURVIVING_WORKFLOW_RESULT");
                    sawCompletionNotification = true;
                    return {
                        content: [
                            {
                                text: "WORKFLOW_COMPLETED_AFTER_WAIT_ABORT",
                                type: "text",
                            },
                        ],
                    };
                }

                throw new Error(`Unexpected inference request: ${lastText}`);
            },
        });
        running.add(gym);

        try {
            submit(gym, "Run the workflow and wait for it to finish.");
            await childStarted;
            await gym.terminal.waitForText("Wait for workflow", 30_000);

            gym.terminal.press("ctrlC");
            const cancelled = await gym.terminal.waitUntil(
                (snapshot) =>
                    snapshot.text.includes("Stopped") &&
                    snapshot.text.includes("Wait for workflow") &&
                    snapshot.text.includes("Ask Rig to do anything"),
                "cancelled workflow wait",
                30_000,
            );
            expect(cancelled.text).toContain("workflow is still running in the background");

            submit(gym, "Confirm what happened to the workflow wait.");
            await gym.terminal.waitForText("WAIT_ABORTED_WORKFLOW_CONTINUES", 30_000);
            expect(sawAbortedWaitResult).toBe(true);

            releaseChild?.();
            const completed = await gym.terminal.waitUntil(
                (snapshot) =>
                    snapshot.text.includes("WORKFLOW_COMPLETED_AFTER_WAIT_ABORT") &&
                    snapshot.text.includes("Ask Rig to do anything"),
                "workflow completion after cancelling only its wait",
                30_000,
            );
            expect(completed.text).toContain("Workflow Surviving workflow completed.");
            expect(sawCompletionNotification).toBe(true);
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
