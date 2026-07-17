import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";
import type { GymInferenceRequest } from "../../rig/sources/providers/gym-types.js";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("waiting for a long workflow", () => {
    it("waits past the old polling window and resumes when the workflow finishes", async () => {
        let parentSessionId: string | undefined;
        let permissionReviews = 0;
        let waitStartedAt = 0;
        let sawCompletionNotification = false;
        const gym = await createGym({
            inference: async (request) => {
                const sessionId = request.options.sessionId;
                const lastText = textOfLastMessage(request);

                if (request.context.systemPrompt?.includes("independent permission reviewer")) {
                    permissionReviews += 1;
                    return {
                        content: [
                            {
                                text: JSON.stringify({
                                    decision: "allow",
                                    reason: "The user explicitly requested this workflow.",
                                    risk: "low",
                                    user_authorization: "high",
                                }),
                                type: "text",
                            },
                        ],
                    };
                }

                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                    expect(
                        (request.context.tools ?? []).some(
                            (tool) =>
                                tool.name === "wait_for_workflow" &&
                                tool.description.toLowerCase().includes("indefinitely"),
                        ),
                    ).toBe(true);
                    return {
                        content: [
                            {
                                arguments: {
                                    description: "Finish after a long-running check",
                                    name: "long-wait",
                                    script: [
                                        'phase("Long check")',
                                        'result = agent("Return LONG_WORKFLOW_RESULT only.", {"label": "Long child"})',
                                        '{"result": result}',
                                    ].join("\n"),
                                },
                                id: "launch-long-workflow",
                                name: "workflow",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (lastText.includes("Return LONG_WORKFLOW_RESULT only.")) {
                    expect(sessionId).not.toBe(parentSessionId);
                    return {
                        content: [{ text: "LONG_WORKFLOW_RESULT", type: "text" }],
                        delayMs: 31_000,
                    };
                }

                const waitResult = toolResultText(request, "wait_for_workflow");
                if (sessionId === parentSessionId && waitResult !== undefined) {
                    expect(Date.now() - waitStartedAt).toBeGreaterThanOrEqual(30_000);
                    expect(JSON.parse(waitResult)).toMatchObject({
                        output: expect.stringContaining("LONG_WORKFLOW_RESULT"),
                        status: "completed",
                    });
                    expect(lastText).toContain("<workflow-notification>");
                    sawCompletionNotification = true;
                    return {
                        content: [{ text: "LONG_WORKFLOW_WAIT_FINISHED", type: "text" }],
                    };
                }

                const launchResult = toolResultText(request, "workflow");
                if (sessionId === parentSessionId && launchResult !== undefined) {
                    const { runId } = JSON.parse(launchResult) as { runId: string };
                    waitStartedAt = Date.now();
                    return {
                        content: [
                            {
                                arguments: { run_id: runId },
                                id: "wait-for-long-workflow",
                                name: "wait_for_workflow",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                throw new Error(`Unexpected inference request: ${lastText}`);
            },
            permissionMode: "auto",
        });
        running.add(gym);

        submit(gym, "Run the long workflow and wait until it is completely finished.");

        const waiting = await gym.terminal.waitForText("Wait for workflow", 30_000);
        expect(waiting.text).toContain("Waiting for the workflow to complete");
        expect(waiting.text).not.toContain("Running 1 tool");
        expect(waiting.text).not.toContain("LONG_WORKFLOW_WAIT_FINISHED");

        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("LONG_WORKFLOW_WAIT_FINISHED") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "agent response after a workflow wait longer than 30 seconds",
            60_000,
        );
        expect(completed.text).toContain("Workflow Long wait completed.");
        expect(sawCompletionNotification).toBe(true);
        expect(permissionReviews).toBe(0);
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
