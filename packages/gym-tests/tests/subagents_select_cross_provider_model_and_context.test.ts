import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();
const parentMarker = "PARENT_CONTEXT_MARKER_7d91";

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("subagent provider, model, and context selection", () => {
    it("infers the unique Anthropic provider for model-only children in both context modes", async () => {
        let parentSessionId: string | undefined;
        let parentContextVerified = false;
        let taskOnlyContextVerified = false;
        let taskOnlyFollowupVerified = false;
        const gym = await createGym({
            cols: 90,
            environment: { ANTHROPIC_API_KEY: "claude-test-key" },
            inference(request) {
                const sessionId = request.options.sessionId;
                expect(sessionId).toBeTypeOf("string");
                if (sessionId?.endsWith(":title")) {
                    return { content: [{ text: "Cross-provider effort", type: "text" }] };
                }
                const lastMessage = request.context.messages.at(-1);
                const lastText = messageText(lastMessage);

                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                    expect(request.providerId).toBe("gym");
                    expect(lastText).toContain(parentMarker);
                    return {
                        content: [
                            {
                                arguments: {
                                    context: "parent",
                                    effort: "high",
                                    message: "Verify inherited context and return PARENT_CHILD_OK.",
                                    model: "anthropic/sonnet-5",
                                    task_name: "parent_context_child",
                                },
                                id: "spawn-parent-context-child",
                                name: "spawn_agent",
                                type: "toolCall",
                            },
                            {
                                arguments: {
                                    context: "task",
                                    effort: "high",
                                    message: "Verify isolated context and return TASK_CHILD_OK.",
                                    model: "anthropic/sonnet-5",
                                    task_name: "task_only_child",
                                },
                                id: "spawn-task-only-child",
                                name: "spawn_agent",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (request.providerId === "claude") {
                    expect(request.providerId).toBe("claude");
                    expect(request.modelId).toBe("anthropic/sonnet-5");
                    const allText = request.context.messages.map(messageText).join("\n");
                    if (lastText.includes("Reuse your context at low effort")) {
                        expect(request.options.thinking).toBe("low");
                        expect(allText).toContain("Verify isolated context");
                        taskOnlyFollowupVerified = true;
                        return { content: [{ text: "TASK_CHILD_FOLLOWUP_LOW", type: "text" }] };
                    }
                    expect(request.options.thinking).toBe("high");
                    if (lastText.includes("Verify inherited context")) {
                        expect(allText).toContain(parentMarker);
                        parentContextVerified = true;
                        return { content: [{ text: "PARENT_CHILD_OK", type: "text" }] };
                    }
                    expect(lastText).toContain("Verify isolated context");
                    expect(allText).not.toContain(parentMarker);
                    taskOnlyContextVerified = true;
                    return { content: [{ text: "TASK_CHILD_OK", type: "text" }] };
                }

                expect(request.providerId).toBe("gym");
                if (lastText.includes("Follow up the task-only child")) {
                    return {
                        content: [
                            {
                                arguments: {
                                    effort: "low",
                                    message: "Reuse your context at low effort.",
                                    target: "task_only_child",
                                },
                                id: "follow-up-task-only-child",
                                name: "followup_task",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (lastText.includes("TASK_CHILD_FOLLOWUP_LOW")) {
                    return { content: [{ text: "PARENT_NOTED_FOLLOWUP", type: "text" }] };
                }
                if (lastText.includes("<subagent-notification>")) {
                    return { content: [{ text: "PARENT_NOTED_CHILD", type: "text" }] };
                }
                if (
                    lastMessage?.role === "toolResult" &&
                    lastMessage.toolName === "followup_task"
                ) {
                    return { content: [{ text: "PARENT_SENT_FOLLOWUP", type: "text" }] };
                }
                if (lastMessage?.role === "toolResult" && lastMessage.toolName === "spawn_agent") {
                    return { content: [{ text: "PARENT_SPAWNED_BOTH", type: "text" }] };
                }
                return { content: [{ text: "Cross-provider effort", type: "text" }] };
            },
            providerOverrides: ["claude"],
            rows: 28,
        });
        running.add(gym);

        gym.terminal.type(`Delegate both context modes. ${parentMarker}`);
        gym.terminal.press("enter");

        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("PARENT_SPAWNED_BOTH") &&
                snapshot.text.includes('"Parent context child" completed in') &&
                snapshot.text.includes('"Task only child" completed in'),
            "both cross-provider subagents to complete",
            30_000,
        );
        expect(parentContextVerified).toBe(true);
        expect(taskOnlyContextVerified).toBe(true);
        expect(completed.text).not.toContain("Tool 'spawn_agent' failed");

        gym.terminal.type("Follow up the task-only child.");
        gym.terminal.press("enter");

        const followedUp = await gym.terminal.waitUntil(
            (snapshot) => snapshot.text.includes("PARENT_NOTED_FOLLOWUP"),
            "the retained child to run its follow-up at low effort",
            30_000,
        );
        expect(taskOnlyFollowupVerified).toBe(true);
        expect(followedUp.text).not.toContain("Tool 'followup_task' failed");
    }, 120_000);
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
