import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Auto-reviewed workflow script paths", () => {
    it("reviews and reads the same home-relative script", async () => {
        const gym = await createGym({
            homeFiles: {
                "saved-workflow.py": '"WORKFLOW_HOME_SCRIPT_RESULT"',
            },
            inference(request, callIndex) {
                if (request.context.systemPrompt?.includes("independent permission reviewer")) {
                    expect(callIndex).toBe(1);
                    const review = messageText(request.context.messages.at(-1));
                    expect(review).toContain("~/saved-workflow.py");
                    return {
                        content: [
                            {
                                text: JSON.stringify({
                                    decision: "allow",
                                    reason: "The user explicitly requested this saved workflow.",
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
                                    description: "Run the saved home workflow",
                                    name: "saved-home-workflow",
                                    scriptPath: "~/saved-workflow.py",
                                },
                                id: "launch-saved-home-workflow",
                                name: "workflow",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                const lastText = messageText(request.context.messages.at(-1));
                if (lastText.includes("<workflow-notification>")) {
                    expect(lastText).toContain("WORKFLOW_HOME_SCRIPT_RESULT");
                    return {
                        content: [{ text: "WORKFLOW_HOME_SCRIPT_ACKNOWLEDGED", type: "text" }],
                    };
                }

                const launchResult = [...request.context.messages]
                    .reverse()
                    .find(
                        (message) =>
                            message.role === "toolResult" && message.toolName === "workflow",
                    );
                if (launchResult !== undefined) {
                    expect(launchResult).toMatchObject({ isError: false });
                    return {
                        content: [{ text: "WORKFLOW_HOME_SCRIPT_LAUNCHED", type: "text" }],
                    };
                }

                throw new Error(`Unexpected inference request ${callIndex}: ${lastText}`);
            },
            permissionMode: "auto",
        });
        running.add(gym);

        submit(gym, "Run my saved workflow at ~/saved-workflow.py.");
        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("WORKFLOW_HOME_SCRIPT_ACKNOWLEDGED") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "reviewed home workflow completion",
            30_000,
        );

        expect(completed.text).toContain("Workflow Saved home workflow completed.");
    }, 120_000);
});

function messageText(message: { content: unknown } | undefined): string {
    if (typeof message?.content === "string") return message.content;
    if (!Array.isArray(message?.content)) return "";
    return message.content
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

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}
