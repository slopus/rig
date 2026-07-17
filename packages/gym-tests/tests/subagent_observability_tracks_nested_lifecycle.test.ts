import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";

import {
    createGym,
    renderTerminalSnapshotPng,
    type Gym,
    type TerminalSnapshot,
} from "@slopus/rig-gym";
import type { Usage } from "../../rig/sources/providers/types.js";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("subagent observability across a nested lifecycle", () => {
    it("shows live and final elapsed time and model tokens exactly once per descendant", async () => {
        const releaseTop = deferred<void>();
        const releaseNested = deferred<void>();
        let parentSessionId: string | undefined;
        let topSessionId: string | undefined;
        let nestedSessionId: string | undefined;
        const gym = await createGym({
            cols: 100,
            rows: 36,
            inference: async (request) => {
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
                                    context: "task",
                                    message: "Spawn the nested observer, then wait for release.",
                                    task_name: "top_observer",
                                },
                                id: "spawn-top-observer",
                                name: "spawn_agent",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (lastText.includes("Spawn the nested observer, then wait for release.")) {
                    topSessionId ??= sessionId;
                    expect(sessionId).toBe(topSessionId);
                    return {
                        content: [
                            {
                                arguments: {
                                    context: "task",
                                    message: "Wait for release, then return NESTED_OBSERVER_DONE.",
                                    task_name: "nested_observer",
                                },
                                id: "spawn-nested-observer",
                                name: "spawn_agent",
                                type: "toolCall",
                            },
                        ],
                        delayMs: 1_100,
                        usage: usage(300),
                    };
                }

                if (lastText.includes("Wait for release, then return NESTED_OBSERVER_DONE.")) {
                    nestedSessionId ??= sessionId;
                    expect(sessionId).toBe(nestedSessionId);
                    await releaseNested.promise;
                    return {
                        content: [{ text: "NESTED_OBSERVER_DONE", type: "text" }],
                        usage: usage(600),
                    };
                }

                if (sessionId === topSessionId && lastMessage?.role === "toolResult") {
                    await releaseTop.promise;
                    return {
                        content: [{ text: "TOP_OBSERVER_DONE", type: "text" }],
                        usage: usage(1_200),
                    };
                }

                if (lastText.includes("<subagent-notification>")) {
                    if (lastText.includes("Task: nested_observer")) {
                        expect(lastText).toContain("NESTED_OBSERVER_DONE");
                        return {
                            content: [{ text: "TOP_ACKNOWLEDGED_NESTED", type: "text" }],
                            usage: usage(100),
                        };
                    }
                    expect(lastText).toContain("Task: top_observer");
                    return {
                        content: [{ text: "PARENT_ACKNOWLEDGED_TOP", type: "text" }],
                    };
                }

                if (lastText.includes("Show wrapped tool output.")) {
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: "printf '%s\\n' 'WRAPPED_TOOL_OUTPUT_abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789_reaches_the_next_terminal_row'",
                                },
                                id: "wrapped-tool-output",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (lastMessage?.role === "toolResult" && lastMessage.toolName === "exec_command") {
                    return { content: [{ text: "WRAPPED_TOOL_OUTPUT_DONE", type: "text" }] };
                }

                expect(sessionId).toBe(parentSessionId);
                expect(lastMessage).toMatchObject({ role: "toolResult", toolName: "spawn_agent" });
                return { content: [{ text: "PARENT_READY_WITH_AGENTS", type: "text" }] };
            },
        });
        running.add(gym);

        submit(gym, "Start the nested observability scenario.");
        await gym.terminal.waitForText("2 agents running", 30_000);
        submit(gym, "/agents");
        const active = await gym.terminal.waitUntil(
            (snapshot) =>
                /Running · Top observer · [1-9]\d*s · 300 tokens/u.test(snapshot.text) &&
                snapshot.text.includes("  Running · Nested observer · 0s · 0 tokens") &&
                snapshot.text.includes("/agents to view ·") &&
                snapshot.text.includes("300 tokens") &&
                snapshot.scroll.atBottom,
            "running nested agents with live metrics",
            30_000,
        );
        await screenshot(active, "running-agents.png");

        releaseTop.resolve();
        const parentWaitingForDescendant = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("1 agent running") &&
                snapshot.text.includes("1.5k tokens") &&
                !snapshot.text.includes('"Top observer" completed in'),
            "top-level completion delayed for its active descendant",
            30_000,
        );
        expect(parentWaitingForDescendant.text.match(/"Top observer" completed in/gu)).toBeNull();

        releaseNested.resolve();
        const completion = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("PARENT_ACKNOWLEDGED_TOP") &&
                /"Top observer" completed in \d+s · 1\.6k tokens\./u.test(snapshot.text) &&
                !snapshot.text.includes("agent running ·") &&
                snapshot.scroll.atBottom,
            "all nested agent work completed",
            30_000,
        );
        expect(completion.text.match(/"Top observer" completed in/gu)).toHaveLength(1);
        expect(completion.text.match(/"Nested observer" completed in/gu)).toHaveLength(1);
        expect(completion.text).not.toMatch(
            /"Top observer" completed in [^.\n]+ · 1\.5k tokens\./u,
        );
        await screenshot(completion, "completion-notice.png");
        submit(gym, "/agents");
        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Completed · Top observer") &&
                snapshot.text.includes("Completed · Nested observer") &&
                snapshot.text.includes("1.6k tokens") &&
                snapshot.text.includes("600 tokens") &&
                snapshot.scroll.atBottom,
            "completed nested agents with persisted metrics",
            30_000,
        );
        expect(completed.text.match(/Completed · Top observer/gu)).toHaveLength(1);
        expect(completed.text.match(/Completed · Nested observer/gu)).toHaveLength(1);
        expect(completed.text.match(/"Top observer" completed in/gu)).toHaveLength(1);
        expect(completed.text.match(/"Nested observer" completed in/gu)).toHaveLength(1);
        expect(completed.text).not.toMatch(/"Top observer" completed in [^.\n]+ · 1\.5k tokens\./u);
        expect(topSessionId).toBeTypeOf("string");
        expect(nestedSessionId).toBeTypeOf("string");
        await screenshot(completed, "completed-agents.png");

        submit(gym, "Show wrapped tool output.");
        const wrappedTool = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("WRAPPED_TOOL_OUTPUT_DONE") &&
                snapshot.text.includes("└ WRAPPED_TOOL_OUTPUT_") &&
                snapshot.text.includes("_next_terminal_row") &&
                snapshot.scroll.atBottom,
            "wrapped tool output with one branch marker",
            30_000,
        );
        expect(
            wrappedTool.rows.filter((row) => row.includes("└ WRAPPED_TOOL_OUTPUT_")),
        ).toHaveLength(1);
        expect(wrappedTool.text).not.toContain("│");
        await screenshot(wrappedTool, "wrapped-tool-output.png");
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function deferred<T>(): { promise: Promise<T>; resolve: (value?: T) => void } {
    let resolvePromise: (value: T | PromiseLike<T>) => void = () => {};
    const promise = new Promise<T>((resolvePromiseValue) => {
        resolvePromise = resolvePromiseValue;
    });
    return { promise, resolve: (value) => resolvePromise(value as T) };
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
        .join("");
}

function usage(totalTokens: number): Usage {
    return {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: totalTokens,
        output: 0,
        totalTokens,
    };
}

async function screenshot(snapshot: TerminalSnapshot, name: string): Promise<void> {
    const directory = process.env.RIG_GYM_SCREENSHOT_DIR;
    if (directory === undefined) return;
    await renderTerminalSnapshotPng(snapshot, resolve(directory, name));
    expect(snapshot.rows).toHaveLength(36);
}
