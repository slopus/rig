import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";
import type { Usage } from "@slopus/rig-execution";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("subagent context token display", () => {
    it("shows the latest context window instead of cumulative usage", async () => {
        let parentSessionId: string | undefined;
        let subagentSessionId: string | undefined;
        const gym = await createGym({
            cols: 110,
            inference: (request) => {
                const sessionId = request.options.sessionId;
                expect(sessionId).toBeTypeOf("string");
                const lastMessage = request.context.messages.at(-1);
                const lastText = messageText(lastMessage?.content);

                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                    return {
                        content: [
                            {
                                arguments: {
                                    fork_turns: "none",
                                    message: "Run one command, then finish.",
                                    task_name: "context_observer",
                                },
                                id: "spawn-context-observer",
                                name: "spawn_agent",
                                namespace: "collaboration",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (lastText.includes("Run one command, then finish.")) {
                    subagentSessionId ??= sessionId;
                    return {
                        content: [
                            {
                                arguments: { cmd: "printf context-window" },
                                id: "measure-context-window",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                        usage: usage({ input: 870_000, output: 30_000 }),
                    };
                }

                if (sessionId === subagentSessionId && lastMessage?.role === "toolResult") {
                    return {
                        content: [{ text: "CONTEXT_OBSERVER_DONE", type: "text" }],
                        usage: usage({ cacheRead: 800_000, input: 120_000, output: 30_000 }),
                    };
                }

                if (lastText.includes("<subagent-notification>")) {
                    return { content: [{ text: "PARENT_ACKNOWLEDGED_CONTEXT", type: "text" }] };
                }

                expect(sessionId).toBe(parentSessionId);
                expect(lastMessage).toMatchObject({
                    role: "toolResult",
                    toolName: "spawn_agent",
                });
                return { content: [{ text: "PARENT_WAITING_FOR_CONTEXT", type: "text" }] };
            },
        });
        running.add(gym);

        gym.terminal.type("Observe the subagent context window.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("PARENT_ACKNOWLEDGED_CONTEXT", 30_000);

        gym.terminal.type("/agents");
        gym.terminal.press("enter");
        const agents = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Completed · Context observer") && snapshot.scroll.atBottom,
            "completed subagent with context usage",
            30_000,
        );

        expect(agents.text).toContain("950k context tokens");
        expect(agents.text).not.toContain("1.1m context tokens");
    }, 60_000);
});

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
        .join("");
}

function usage(values: {
    cacheRead?: number;
    cacheWrite?: number;
    input: number;
    output: number;
}): Usage {
    const cacheRead = values.cacheRead ?? 0;
    const cacheWrite = values.cacheWrite ?? 0;
    return {
        cacheRead,
        cacheWrite,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: values.input,
        output: values.output,
        totalTokens: values.input + values.output + cacheRead + cacheWrite,
    };
}
