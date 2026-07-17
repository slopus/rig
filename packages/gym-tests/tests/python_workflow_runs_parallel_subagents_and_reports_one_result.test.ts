import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Python workflow orchestration", () => {
    it("runs sandboxed parallel subagents and reports one consolidated result", async () => {
        const childSessions = new Set<string>();
        let releaseChildren: (() => void) | undefined;
        const bothChildrenStarted = new Promise<void>((resolve) => {
            releaseChildren = resolve;
        });
        let parentSessionId: string | undefined;
        let sawLaunchResult = false;
        let sawWorkflowNotification = false;
        const gym = await createGym({
            inference: async (request) => {
                const sessionId = request.options.sessionId;
                expect(sessionId).toBeTypeOf("string");
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
                    expect(lastText).toContain("Run the deterministic Python workflow.");
                    return {
                        content: [
                            {
                                arguments: {
                                    description: "Collect two independent checks",
                                    name: "parallel-checks",
                                    script: [
                                        'phase("Inspect")',
                                        "results = parallel([",
                                        '    {"prompt": "Return WORKFLOW_ALPHA only.", "label": "Alpha check", "model": "openai/gym"},',
                                        '    {"prompt": "Return WORKFLOW_BETA only.", "label": "Beta check", "model": "openai/gym"},',
                                        "])",
                                        'summary = agent("Consolidate the completed inspection reports. Return WORKFLOW_CONSOLIDATED only.", {"label": "Consolidate", "model": "openai/gym"})',
                                        '{"checks": results, "summary": summary}',
                                    ].join("\n"),
                                },
                                id: "launch-python-workflow",
                                name: "workflow",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (lastText.includes("Return WORKFLOW_ALPHA only.")) {
                    expect(sessionId).not.toBe(parentSessionId);
                    expect(request.modelId).toBe("openai/gym");
                    childSessions.add(sessionId ?? "");
                    if (childSessions.size === 2) releaseChildren?.();
                    await bothChildrenStarted;
                    return { content: [{ text: "WORKFLOW_ALPHA", type: "text" }] };
                }

                if (lastText.includes("Return WORKFLOW_BETA only.")) {
                    expect(sessionId).not.toBe(parentSessionId);
                    expect(request.modelId).toBe("openai/gym");
                    childSessions.add(sessionId ?? "");
                    if (childSessions.size === 2) releaseChildren?.();
                    await bothChildrenStarted;
                    return { content: [{ text: "WORKFLOW_BETA", type: "text" }] };
                }

                if (lastText.includes("Return WORKFLOW_CONSOLIDATED only.")) {
                    expect(sessionId).not.toBe(parentSessionId);
                    expect(request.modelId).toBe("openai/gym");
                    childSessions.add(sessionId ?? "");
                    return { content: [{ text: "WORKFLOW_CONSOLIDATED", type: "text" }] };
                }

                const launchResult = [...request.context.messages]
                    .reverse()
                    .find(
                        (message) =>
                            message.role === "toolResult" && message.toolName === "workflow",
                    );
                if (launchResult !== undefined && !sawLaunchResult) {
                    sawLaunchResult = true;
                    const text =
                        typeof launchResult.content === "string"
                            ? launchResult.content
                            : launchResult.content
                                  .filter((block) => block.type === "text")
                                  .map((block) => block.text)
                                  .join("");
                    expect(JSON.parse(text)).toMatchObject({
                        name: "parallel-checks",
                        status: "async_launched",
                    });
                    return {
                        content: [{ text: "WORKFLOW_LAUNCHED", type: "text" }],
                    };
                }

                if (lastText.includes("<workflow-notification>")) {
                    expect(lastText).toContain("Status: completed");
                    expect(lastText).toContain("WORKFLOW_ALPHA");
                    expect(lastText).toContain("WORKFLOW_BETA");
                    expect(lastText).toContain("WORKFLOW_CONSOLIDATED");
                    sawWorkflowNotification = true;
                    return {
                        content: [{ text: "WORKFLOW_RESULT_ACKNOWLEDGED", type: "text" }],
                    };
                }

                throw new Error(`Unexpected inference request: ${lastText}`);
            },
        });
        running.add(gym);

        gym.terminal.type("Run the deterministic Python workflow.");
        gym.terminal.press("enter");

        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("WORKFLOW_RESULT_ACKNOWLEDGED") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "consolidated workflow result",
            30_000,
        );

        expect(completed.text).toContain("Workflow Parallel checks completed.");
        expect(childSessions.size).toBe(3);
        expect(sawLaunchResult).toBe(true);
        expect(sawWorkflowNotification).toBe(true);
    }, 120_000);
});
