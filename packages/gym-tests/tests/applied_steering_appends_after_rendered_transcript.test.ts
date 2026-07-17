import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("applied steering transcript order", () => {
    it("appends steering after transcript entries rendered while it was pending", async () => {
        const releaseInference = deferred<void>();
        const steering = "STEERING_APPLIED_AT_BOUNDARY";
        const assistantBeforeSteering = "ASSISTANT_RENDERED_BEFORE_STEERING";
        const gym = await createGym({
            cols: 100,
            async inference(request, callIndex) {
                if (callIndex === 0) {
                    await releaseInference.promise;
                    return {
                        content: [
                            { text: assistantBeforeSteering, type: "text" },
                            {
                                arguments: { cmd: "printf 'TOOL_BEFORE_STEERING\\n'" },
                                id: "tool-before-steering",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(1);
                expect(
                    request.context.messages
                        .filter((message) => message.role === "user")
                        .map((message) => JSON.stringify(message.content))
                        .join("\n"),
                ).toContain(steering);
                return { content: [{ text: "STEERING_ORDER_COMPLETE", type: "text" }] };
            },
            rows: 32,
        });
        running.add(gym);

        submit(gym, "Wait for steering, then run the tool.");
        await gym.terminal.waitForText("esc to interrupt", 30_000);

        submit(gym, steering);
        await gym.terminal.waitForText("Messages to be submitted after next tool call", 30_000);

        releaseInference.resolve();
        const settled = await gym.terminal.waitForText("STEERING_ORDER_COMPLETE", 30_000);
        expect(settled.text.indexOf(assistantBeforeSteering)).toBeGreaterThanOrEqual(0);
        expect(settled.text.indexOf(steering)).toBeGreaterThanOrEqual(0);
        expect(settled.text.indexOf(assistantBeforeSteering)).toBeLessThan(
            settled.text.indexOf(steering),
        );
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
