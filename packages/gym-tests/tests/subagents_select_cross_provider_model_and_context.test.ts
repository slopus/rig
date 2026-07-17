import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();
const parentMarker = "PARENT_CONTEXT_MARKER_7d91";

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("subagent provider, model, and context selection", () => {
    it("runs Anthropic children with parent-thread or task-only context", async () => {
        let parentSessionId: string | undefined;
        let parentContextVerified = false;
        let taskOnlyContextVerified = false;
        const gym = await createGym({
            cols: 90,
            inference(request) {
                const sessionId = request.options.sessionId;
                expect(sessionId).toBeTypeOf("string");
                const lastText = messageText(request.context.messages.at(-1));

                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                    expect(request.providerId).toBe("gym");
                    expect(lastText).toContain(parentMarker);
                    return {
                        content: [
                            {
                                arguments: {
                                    context: "parent",
                                    message: "Verify inherited context and return PARENT_CHILD_OK.",
                                    model: "anthropic/sonnet-4-6",
                                    provider: "claude",
                                    task_name: "parent_context_child",
                                },
                                id: "spawn-parent-context-child",
                                name: "spawn_agent",
                                type: "toolCall",
                            },
                            {
                                arguments: {
                                    context: "task",
                                    message: "Verify isolated context and return TASK_CHILD_OK.",
                                    model: "anthropic/sonnet-4-6",
                                    provider: "claude",
                                    task_name: "task_only_child",
                                },
                                id: "spawn-task-only-child",
                                name: "spawn_agent",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (sessionId !== parentSessionId) {
                    expect(request.providerId).toBe("claude");
                    expect(request.modelId).toBe("anthropic/sonnet-4-6");
                    const allText = request.context.messages.map(messageText).join("\n");
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

                if (lastText.includes("<subagent-notification>")) {
                    return { content: [{ text: "PARENT_NOTED_CHILD", type: "text" }] };
                }
                return { content: [{ text: "PARENT_SPAWNED_BOTH", type: "text" }] };
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
