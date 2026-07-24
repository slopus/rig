import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Claude parallel background agent and Auto approval", () => {
    it("keeps the approval choices visible after a mixed tool batch completes", async () => {
        let parentSessionId: string | undefined;
        let parentCall = 0;
        const gym = await createGym({
            environment: { ANTHROPIC_API_KEY: "claude-test-key" },
            files: {
                "bash.txt": "read me\n",
                tool: "read this too\n",
                "write.txt": "before\n",
            },
            inference(request) {
                const sessionId = request.options.sessionId;
                if (request.context.systemPrompt?.includes("independent permission reviewer")) {
                    const reviewerMessage = request.context.messages.at(-1);
                    const reviewerText =
                        typeof reviewerMessage?.content === "string"
                            ? reviewerMessage.content
                            : JSON.stringify(reviewerMessage?.content);
                    const proposedAction = reviewerText.slice(
                        reviewerText.lastIndexOf("<proposed_action>"),
                    );
                    if (proposedAction.includes("https://example.com")) {
                        return {
                            content: [
                                {
                                    text: JSON.stringify({
                                        decision: "ask",
                                        reason: "The network fetch needs explicit approval.",
                                        risk: "medium",
                                        user_authorization: "low",
                                    }),
                                    type: "text",
                                },
                            ],
                        };
                    }
                    return {
                        content: [
                            {
                                text: JSON.stringify({
                                    decision: "allow",
                                    reason: "This routine workspace action is safe.",
                                    risk: "low",
                                    user_authorization: "low",
                                }),
                                type: "text",
                            },
                        ],
                    };
                }
                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                }
                if (sessionId !== parentSessionId) {
                    return {
                        content: [{ text: "BACKGROUND_FINISHED", type: "text" }],
                    };
                }
                if (parentCall++ === 0) {
                    return {
                        content: [
                            {
                                arguments: {
                                    activeForm: "Preparing tool checks",
                                    description: "Exercise the mixed tool batch.",
                                    subject: "Prepare tool checks",
                                },
                                id: "create-task",
                                name: "TaskCreate",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                return {
                    content: [
                        {
                            arguments: { file_path: "/workspace/bash.txt" },
                            id: "parallel-read",
                            name: "Read",
                            type: "toolCall",
                        },
                        {
                            arguments: {
                                file_path: "/workspace/write.txt",
                                new_string: "after",
                                old_string: "before",
                            },
                            id: "parallel-edit",
                            name: "Edit",
                            type: "toolCall",
                        },
                        {
                            arguments: {},
                            id: "parallel-task-list",
                            name: "TaskList",
                            type: "toolCall",
                        },
                        {
                            arguments: { taskId: "1" },
                            id: "parallel-task-get",
                            name: "TaskGet",
                            type: "toolCall",
                        },
                        {
                            arguments: {
                                prompt: "Summarize.",
                                url: "https://example.com",
                            },
                            id: "parallel-approval",
                            name: "WebFetch",
                            type: "toolCall",
                        },
                        {
                            arguments: { file_path: "/workspace/tool" },
                            id: "parallel-second-read",
                            name: "Read",
                            type: "toolCall",
                        },
                        {
                            arguments: {
                                description: "Finish in background",
                                prompt: "Return BACKGROUND_FINISHED.",
                            },
                            id: "parallel-agent",
                            name: "Agent",
                            type: "toolCall",
                        },
                    ],
                };
            },
            modelId: "anthropic/opus-4-8",
            permissionMode: "auto",
            providerId: "claude",
            providerOverrides: ["claude"],
        });
        running.add(gym);

        gym.terminal.type("Start the background check and fetch the page.");
        gym.terminal.press("enter");

        const approval = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Background work") &&
                snapshot.text.includes('"Finish in background" completed') &&
                snapshot.text.includes("Waiting for approval") &&
                snapshot.text.includes("Allow once") &&
                snapshot.text.includes("Deny"),
            "the answerable approval prompt after the mixed tool batch completes",
            30_000,
        );
        expect(approval.text).toContain("Permission");
        expect(approval.text).toContain("example.com");
        expect(approval.text).toContain("network fetch needs explicit approval");
    }, 60_000);
});
