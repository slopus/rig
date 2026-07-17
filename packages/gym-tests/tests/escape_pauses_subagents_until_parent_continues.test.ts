import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Escape pauses delegated work with the parent", () => {
    it("hides inactive agents and requires the parent to explicitly resume retained work", async () => {
        let parentSessionId: string | undefined;
        let childRunCount = 0;
        const gym = await createGym({
            cols: 92,
            inference: (request) => {
                const sessionId = request.options.sessionId;
                const lastMessage = request.context.messages.at(-1);
                const lastText = messageText(lastMessage?.content);

                if (sessionId?.endsWith(":title")) {
                    return { content: [{ text: "Paused delegation", type: "text" }] };
                }

                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                    return {
                        content: [
                            {
                                arguments: {
                                    context: "task",
                                    message: "Audit until the parent continues.",
                                    task_name: "paused_audit",
                                },
                                id: "spawn-paused-audit",
                                name: "spawn_agent",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (lastText.includes("Continue the parent and its delegated work.")) {
                    expect(childRunCount).toBe(1);
                    expect(
                        request.context.messages
                            .map((message) => messageText(message.content))
                            .join("\n"),
                    ).toContain("They will not resume automatically");
                    return {
                        content: [
                            {
                                arguments: { target: "paused_audit" },
                                id: "resume-paused-audit",
                                name: "resume_agent",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (lastText.includes("<subagent-notification>")) {
                    return { content: [{ text: "PARENT_SAW_RESUMED_CHILD", type: "text" }] };
                }
                if (lastMessage?.role === "toolResult") {
                    if (lastMessage.toolName === "resume_agent") {
                        return { content: [{ text: "PARENT_RESUMED_CHILD", type: "text" }] };
                    }
                    return {
                        content: [{ text: "STALE_PARENT_RESPONSE", type: "text" }],
                        delayMs: 30_000,
                    };
                }

                if (lastText.includes("Audit until the parent continues.")) {
                    childRunCount += 1;
                    return {
                        content: [{ text: "STALE_CHILD_RESPONSE", type: "text" }],
                        delayMs: 30_000,
                    };
                }
                if (lastText.includes("Continue the delegated task")) {
                    childRunCount += 1;
                    expect(
                        request.context.messages
                            .map((message) => messageText(message.content))
                            .join("\n"),
                    ).toContain("Audit until the parent continues.");
                    return { content: [{ text: "RESUMED_CHILD_RESPONSE", type: "text" }] };
                }

                throw new Error(`Unexpected inference request: ${lastText}`);
            },
            rows: 24,
        });
        running.add(gym);

        submit(gym, "Start a delegated audit and keep working.");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("1 agent running · /agents to view") &&
                snapshot.text.includes("esc to interrupt") &&
                childRunCount === 1,
            "the parent and child to be active together",
            30_000,
        );

        gym.terminal.press("escape");
        const paused = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes('"Paused audit" was suspended in') &&
                snapshot.text.includes("Subagents suspended") &&
                snapshot.text.includes("1 subagent was suspended: Paused audit") &&
                !snapshot.text.includes("agent running · /agents to view") &&
                !snapshot.text.includes("esc to interrupt") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "Escape to pause the parent and remove the inactive agent row",
            30_000,
        );
        expect(paused.text).not.toContain("STALE_PARENT_RESPONSE");
        expect(paused.text).not.toContain("STALE_CHILD_RESPONSE");

        submit(gym, "/agents");
        const retained = await gym.terminal.waitForText("Suspended · Paused audit", 30_000);
        expect(retained.text).not.toContain("agent running · /agents to view");

        submit(gym, "Continue the parent and its delegated work.");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("PARENT_RESUMED_CHILD") &&
                childRunCount === 2 &&
                snapshot.text.includes('"Paused audit" completed in') &&
                !snapshot.text.includes("agent running · /agents to view"),
            "the next parent turn to resume and complete the retained child",
            30_000,
        );

        submit(gym, "/agents");
        const completed = await gym.terminal.waitForText("Completed · Paused audit", 30_000);
        expect(completed.text).not.toContain("STALE_PARENT_RESPONSE");
        expect(completed.text).not.toContain("STALE_CHILD_RESPONSE");
        expect(childRunCount).toBe(2);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function messageText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
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
