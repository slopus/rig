import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Claude SendMessage to a completed agent", () => {
    it("wakes the same agent session and retrieves its follow-up result", async () => {
        let parentSessionId: string | undefined;
        let agentId: string | undefined;
        let sendMessageIssued = false;
        let secondOutputRequested = false;
        let childRuns = 0;
        const childRunIds = new Set<string>();
        const gym = await createGym({
            environment: { ANTHROPIC_API_KEY: "claude-test-key" },
            inference(request) {
                const sessionId = request.options.sessionId;
                expect(sessionId).toBeTypeOf("string");
                const lastMessage = request.context.messages.at(-1);
                const lastText = messageText(lastMessage);
                const transcript = JSON.stringify(request.context.messages);

                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                    return {
                        content: [
                            {
                                arguments: {
                                    description: "Reusable completed agent",
                                    prompt: "Return FIRST_AGENT_COMPLETION only.",
                                },
                                id: "launch-reusable-agent",
                                name: "Agent",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (sessionId !== parentSessionId) {
                    childRunIds.add(sessionId!);
                    childRuns += 1;
                    if (
                        lastText.includes(
                            "Continue the same agent and return SECOND_AGENT_COMPLETION",
                        )
                    ) {
                        expect(transcript).toContain("FIRST_AGENT_COMPLETION");
                        return {
                            content: [{ text: "SECOND_AGENT_COMPLETION", type: "text" }],
                        };
                    }
                    expect(lastText).toContain("Return FIRST_AGENT_COMPLETION only.");
                    return {
                        content: [{ text: "FIRST_AGENT_COMPLETION", type: "text" }],
                        delayMs: 200,
                    };
                }

                if (lastMessage?.role === "toolResult" && lastMessage.toolName === "Agent") {
                    const launch = JSON.parse(lastText) as { agentId: string; status: string };
                    expect(launch.status).toBe("async_launched");
                    agentId = launch.agentId;
                    return {
                        content: [
                            {
                                arguments: {
                                    block: true,
                                    task_id: launch.agentId,
                                    timeout: 5_000,
                                },
                                id: "read-first-completion",
                                name: "TaskOutput",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (transcript.includes("FIRST_AGENT_COMPLETION") && !sendMessageIssued) {
                    expect(agentId).toBeTypeOf("string");
                    sendMessageIssued = true;
                    return {
                        content: [
                            {
                                arguments: {
                                    to: agentId,
                                    message:
                                        "Continue the same agent and return SECOND_AGENT_COMPLETION only.",
                                    summary: "Resume completed agent",
                                },
                                id: "resume-completed-agent",
                                name: "SendMessage",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (
                    lastMessage?.role === "toolResult" &&
                    lastMessage.toolName === "SendMessage" &&
                    !secondOutputRequested
                ) {
                    expect(JSON.parse(lastText)).toMatchObject({
                        success: true,
                        target: expect.stringContaining("/root/"),
                    });
                    secondOutputRequested = true;
                    return {
                        content: [
                            {
                                arguments: {
                                    block: true,
                                    task_id: agentId,
                                    timeout: 5_000,
                                },
                                id: "read-second-completion",
                                name: "TaskOutput",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (
                    lastText.includes("SECOND_AGENT_COMPLETION") &&
                    (lastMessage?.role === "user" ||
                        (lastMessage?.role === "toolResult" &&
                            lastMessage.toolName === "TaskOutput"))
                ) {
                    return {
                        content: [
                            {
                                text: "CLAUDE_RESUMED_COMPLETED_AGENT",
                                type: "text",
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

        gym.terminal.type("Complete work in an agent, then wake it for follow-up work.");
        gym.terminal.press("enter");

        const settled = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("CLAUDE_RESUMED_COMPLETED_AGENT") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "Claude to resume and retrieve output from the completed agent",
            30_000,
        );

        expect(settled.text).not.toContain("already completed and was released");
        expect(settled.text).not.toContain("Tool 'SendMessage' failed");
        expect(childRuns).toBe(2);
        expect(childRunIds.size).toBe(2);
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
