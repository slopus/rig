import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("workflow inspection", () => {
    it("opens workflow code and each agent's prompt and latest message", async () => {
        let parentSessionId: string | undefined;
        const gym = await createGym({
            inference: async (request) => {
                const sessionId = request.options.sessionId;
                const lastMessage = request.context.messages.at(-1);
                const lastText =
                    typeof lastMessage?.content === "string"
                        ? lastMessage.content
                        : (lastMessage?.content ?? [])
                              .filter((block) => block.type === "text")
                              .map((block) => block.text)
                              .join("");

                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                    return {
                        content: [
                            {
                                arguments: {
                                    description: "Inspect two visible agents",
                                    name: "inspectable-workflow",
                                    script: [
                                        'phase("Review")',
                                        "results = parallel([",
                                        '    {"prompt": "INCOMING_ALPHA_PROMPT", "label": "Alpha review"},',
                                        '    {"prompt": "INCOMING_BETA_PROMPT", "label": "Beta review"},',
                                        "])",
                                        '{"results": results}',
                                    ].join("\n"),
                                },
                                id: "launch-inspectable-workflow",
                                name: "workflow",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (lastText?.includes("INCOMING_ALPHA_PROMPT")) {
                    return { content: [{ text: "LATEST_ALPHA_MESSAGE", type: "text" }] };
                }
                if (lastText?.includes("INCOMING_BETA_PROMPT")) {
                    return { content: [{ text: "LATEST_BETA_MESSAGE", type: "text" }] };
                }
                if (lastText?.includes("<workflow-notification>")) {
                    return { content: [{ text: "WORKFLOW_INSPECTION_READY", type: "text" }] };
                }

                const launched = request.context.messages.some(
                    (message) => message.role === "toolResult" && message.toolName === "workflow",
                );
                if (launched) {
                    return { content: [{ text: "WORKFLOW_LAUNCHED", type: "text" }] };
                }

                throw new Error(`Unexpected inference request: ${lastText}`);
            },
        });
        running.add(gym);

        gym.terminal.type("Run an inspectable workflow.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("WORKFLOW_INSPECTION_READY", 30_000);

        gym.terminal.type("/workflows");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Inspectable workflow", 30_000);
        gym.terminal.press("enter");

        const detail = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("View workflow code") &&
                snapshot.text.includes("Agent 1") &&
                snapshot.text.includes("Agent 2") &&
                snapshot.scroll.atBottom,
            "workflow actions and launched agents",
            30_000,
        );
        expect(detail.text).toContain("Alpha review");
        expect(detail.text).toContain("Beta review");

        gym.terminal.press("enter");
        const code = await gym.terminal.waitForText("Workflow code", 30_000);
        expect(code.text).toContain("INCOMING_ALPHA_PROMPT");
        expect(code.text).toContain("INCOMING_BETA_PROMPT");

        gym.terminal.press("escape");
        gym.terminal.press("down");
        gym.terminal.press("enter");
        const firstAgent = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Incoming prompt") &&
                snapshot.text.includes("INCOMING_ALPHA_PROMPT") &&
                snapshot.text.includes("Latest message") &&
                snapshot.text.includes("LATEST_ALPHA_MESSAGE"),
            "first workflow agent detail",
            30_000,
        );
        expect(firstAgent.scroll.atBottom).toBe(true);

        gym.terminal.press("escape");
        gym.terminal.press("down");
        gym.terminal.press("enter");
        const secondAgent = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Incoming prompt") &&
                snapshot.text.includes("INCOMING_BETA_PROMPT") &&
                snapshot.text.includes("Latest message") &&
                snapshot.text.includes("LATEST_BETA_MESSAGE"),
            "second workflow agent detail",
            30_000,
        );
        expect(secondAgent.scroll.atBottom).toBe(true);
    }, 120_000);
});
