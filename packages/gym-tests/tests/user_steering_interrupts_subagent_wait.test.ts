import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("user steering during a subagent wait", () => {
    it("interrupts the wait and continues with the scheduled message", async () => {
        const releaseChild = deferred<void>();
        let parentSessionId: string | undefined;
        const gym = await createGym({
            inference: async (request) => {
                const sessionId = request.options.sessionId;
                expect(sessionId).toBeTypeOf("string");
                const serialized = JSON.stringify(request.context.messages);
                const lastMessage = request.context.messages.at(-1);

                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                    return {
                        content: [
                            {
                                arguments: {
                                    context: "task",
                                    message: "Stay active until the parent changes direction.",
                                    task_name: "long_running_child",
                                },
                                id: "spawn-long-running-child",
                                name: "spawn_agent",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (sessionId !== parentSessionId) {
                    await releaseChild.promise;
                    return { content: [{ text: "CHILD_RELEASED", type: "text" }] };
                }

                if (lastMessage?.role === "toolResult" && lastMessage.toolName === "spawn_agent") {
                    return {
                        content: [
                            {
                                arguments: { timeout_ms: 60_000 },
                                id: "wait-for-long-running-child",
                                name: "wait_agent",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                expect(serialized).toContain("Change direction without waiting.");
                expect(lastMessage).toMatchObject({
                    role: "user",
                    content: [{ type: "text", text: "Change direction without waiting." }],
                });
                expect(serialized).toContain("Waiting for subagents was interrupted by new input.");
                return { content: [{ text: "STEERING_INTERRUPTED_WAIT", type: "text" }] };
            },
            rows: 28,
        });
        running.add(gym);

        try {
            submit(gym, "Delegate work and wait for it.");
            await gym.terminal.waitForText("Wait for delegated work", 30_000);

            submit(gym, "Change direction without waiting.");
            const completed = await gym.terminal.waitForText("STEERING_INTERRUPTED_WAIT", 3_000);

            expect(completed.text).toContain("Change direction without waiting.");
            expect(completed.text).toContain("Ask Rig to do anything");
        } finally {
            releaseChild.resolve();
        }
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function deferred<T>(): { promise: Promise<T>; resolve: (value?: T) => void } {
    let resolvePromise: (value: T | PromiseLike<T>) => void = () => {};
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return {
        promise,
        resolve: (value) => resolvePromise(value as T),
    };
}
