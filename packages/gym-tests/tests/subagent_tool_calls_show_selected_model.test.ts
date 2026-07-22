import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("subagent tool call model display", () => {
    it("shows explicit and inherited selected models in live call rows", async () => {
        const releaseChildren = deferred<void>();
        let parentSessionId: string | undefined;
        const gym = await createGym({
            inference: async (request) => {
                const sessionId = request.options.sessionId;
                if (sessionId?.endsWith(":title") === true) {
                    return { content: [{ text: "Subagent model display", type: "text" }] };
                }
                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                    return {
                        content: [
                            {
                                arguments: {
                                    context: "task",
                                    message: "Wait, then return EXPLICIT_CHILD_DONE.",
                                    model: "openai/gym",
                                    task_name: "explicit_child",
                                },
                                id: "spawn-explicit-child",
                                name: "spawn_agent",
                                type: "toolCall",
                            },
                            {
                                arguments: {
                                    context: "task",
                                    message: "Wait, then return INHERITED_CHILD_DONE.",
                                    task_name: "inherited_child",
                                },
                                id: "spawn-inherited-child",
                                name: "spawn_agent",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (sessionId !== parentSessionId) {
                    await releaseChildren.promise;
                    const prompt = messageText(request.context.messages.at(-1));
                    return {
                        content: [
                            {
                                text: prompt.includes("EXPLICIT")
                                    ? "EXPLICIT_CHILD_DONE"
                                    : "INHERITED_CHILD_DONE",
                                type: "text",
                            },
                        ],
                    };
                }
                const lastMessage = request.context.messages.at(-1);
                if (messageText(lastMessage).includes("<subagent-notification>")) {
                    return { content: [{ text: "PARENT_NOTED_CHILD", type: "text" }] };
                }
                return { content: [{ text: "PARENT_SPAWNED_CHILDREN", type: "text" }] };
            },
            rows: 28,
        });
        running.add(gym);

        gym.terminal.type("Start explicit and inherited model children.");
        gym.terminal.press("enter");

        const spawned = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("PARENT_SPAWNED_CHILDREN") &&
                snapshot.text.includes("2 agents running"),
            "both model-labelled subagent calls",
            30_000,
        );
        expect(spawned.text).toContain("Explicit child · Gym");
        expect(spawned.text).toContain("Inherited child · Gym");

        releaseChildren.resolve();
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes('"Explicit child" completed in') &&
                snapshot.text.includes('"Inherited child" completed in'),
            "both children to complete",
            30_000,
        );
    }, 120_000);
});

function deferred<T>(): { promise: Promise<T>; resolve: (value?: T) => void } {
    let resolvePromise: (value: T | PromiseLike<T>) => void = () => {};
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return { promise, resolve: (value) => resolvePromise(value as T) };
}

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
