import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Claude background agent task output", () => {
    it("launches Agent in the background by default and retrieves its final output", async () => {
        let parentSessionId: string | undefined;
        let launchedAgentId: string | undefined;
        const gym = await createGym({
            environment: { ANTHROPIC_API_KEY: "claude-test-key" },
            inference(request) {
                const sessionId = request.options.sessionId;
                expect(sessionId).toBeTypeOf("string");
                const lastMessage = request.context.messages.at(-1);
                const lastText = messageText(lastMessage);

                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                    expect(request.providerId).toBe("claude");
                    expect(request.context.tools?.map((tool) => tool.name)).toEqual(
                        expect.arrayContaining(["Agent", "TaskOutput"]),
                    );
                    return {
                        content: [
                            {
                                arguments: {
                                    description: "Inspect default background behavior",
                                    prompt: "Return CLAUDE_BACKGROUND_AGENT_RESULT only.",
                                },
                                id: "launch-claude-background-agent",
                                name: "Agent",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (sessionId !== parentSessionId) {
                    expect(lastText).toContain("Return CLAUDE_BACKGROUND_AGENT_RESULT only.");
                    return {
                        content: [
                            {
                                text: "CLAUDE_BACKGROUND_AGENT_RESULT",
                                type: "text",
                            },
                        ],
                        delayMs: 500,
                    };
                }

                if (lastMessage?.role === "toolResult" && lastMessage.toolName === "Agent") {
                    const launch = JSON.parse(lastText) as {
                        agentId: string;
                        status: string;
                    };
                    expect(launch.status).toBe("async_launched");
                    launchedAgentId = launch.agentId;
                    return {
                        content: [
                            {
                                arguments: {
                                    block: true,
                                    task_id: launch.agentId,
                                    timeout: 5_000,
                                },
                                id: "read-claude-background-agent",
                                name: "TaskOutput",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (
                    lastMessage?.role === "toolResult" &&
                    lastMessage.toolName === "TaskOutput"
                ) {
                    expect(JSON.parse(lastText)).toMatchObject({
                        retrieval_status: "success",
                        task: {
                            output: "CLAUDE_BACKGROUND_AGENT_RESULT",
                            status: "completed",
                            task_id: launchedAgentId,
                            task_type: "local_agent",
                        },
                    });
                    return {
                        content: [
                            {
                                text: "CLAUDE_RETRIEVED_BACKGROUND_AGENT_OUTPUT",
                                type: "text",
                            },
                        ],
                    };
                }

                if (lastText.includes("<subagent-notification>")) {
                    expect(lastText).toContain("CLAUDE_BACKGROUND_AGENT_RESULT");
                    expect(launchedAgentId).toBeTypeOf("string");
                    return {
                        content: [
                            {
                                arguments: {
                                    block: false,
                                    task_id: launchedAgentId,
                                },
                                id: "read-completed-claude-background-agent",
                                name: "TaskOutput",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                throw new Error(`Unexpected parent request: ${lastText}`);
            },
            modelId: "anthropic/sonnet-5",
            providerId: "claude",
            providerOverrides: ["claude"],
        });
        running.add(gym);

        gym.terminal.type("Delegate this work and wait for its result.");
        gym.terminal.press("enter");

        const settled = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("CLAUDE_RETRIEVED_BACKGROUND_AGENT_OUTPUT") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "Claude to retrieve its default background agent output",
            30_000,
        );

        expect(launchedAgentId).toBeTypeOf("string");
        expect(settled.text).toContain("Background agent output is ready.");
        expect(settled.text).not.toContain("Tool 'TaskOutput' failed");
    }, 60_000);
});

function messageText(
    message: { content: string | readonly { text?: string; type: string }[] } | undefined,
): string {
    if (message === undefined) return "";
    if (typeof message.content === "string") return message.content;
    return message.content
        .filter((block): block is { text: string; type: string } => typeof block.text === "string")
        .map((block) => block.text)
        .join("");
}
