import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";
import type { GymInferenceRequest } from "../../rig/sources/providers/gym-types.js";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Kimi K3 conversation compaction", () => {
    it("uses Kimi's handoff prompt, max reasoning, and the compacted context", async () => {
        let agentCallIndex = 0;
        const firstResponseStarted = deferred<void>();
        const releaseFirstResponse = deferred<void>();
        let firstInferenceContext: GymInferenceRequest["context"] | undefined;
        const gym = await createGym({
            contextWindow: 500,
            environment: { KIMI_API_KEY: "kimi-test-key" },
            async inference(request) {
                if (request.options.sessionId?.endsWith(":title") === true) {
                    return { content: [{ text: "Kimi compaction", type: "text" }] };
                }
                const callIndex = agentCallIndex++;
                expect(request.providerId).toBe("kimi");
                expect(request.modelId).toBe("moonshot/kimi-k3");
                expect(request.options.thinking).toBe("max");

                if (callIndex === 0) {
                    firstInferenceContext = request.context;
                    expect(request.context.systemPrompt).toContain(
                        "You are Kimi Code, operating as Rig",
                    );
                    expect(request.context.tools?.map((tool) => tool.name)).toContain("Read");
                    firstResponseStarted.resolve();
                    await releaseFirstResponse.promise;
                    return {
                        content: [
                            {
                                text: `Loaded Kimi context.\n${"important detail ".repeat(160)}`,
                                type: "text",
                            },
                        ],
                        usage: usage(400, 50),
                    };
                }

                if (callIndex === 1) {
                    expect(request.context.systemPrompt).toBe(firstInferenceContext?.systemPrompt);
                    expect(request.context.tools).toEqual(firstInferenceContext?.tools);
                    expect(request.context.messages[0]).toMatchObject({
                        role: firstInferenceContext?.messages[0]?.role,
                        content: firstInferenceContext?.messages[0]?.content,
                    });
                    expect(lastUserText(request.context)).toMatch(
                        /^You are about to run out of context\. Write a first-person handoff note/u,
                    );
                    return {
                        content: [
                            {
                                text: "I loaded the Kimi context and must continue the requested verification.",
                                type: "text",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(2);
                expect(request.context.systemPrompt).toContain(
                    "You are Kimi Code, operating as Rig",
                );
                expect(JSON.stringify(request.context.messages)).toContain(
                    "I loaded the Kimi context",
                );
                return {
                    content: [{ text: "KIMI_COMPACTION_CONTINUED", type: "text" }],
                    usage: usage(100, 25),
                };
            },
            providerId: "kimi",
            providerOverrides: ["kimi"],
            rows: 26,
        });
        running.add(gym);

        submit(gym, "Load enough detail to compact this Kimi session.");
        await firstResponseStarted.promise;
        await gym.terminal.waitForText("Working", 30_000);
        gym.terminal.type("Continue after preserving the important details.");
        await gym.terminal.waitForText(
            "› Continue after preserving the important details.",
            30_000,
        );
        gym.terminal.press("tab");
        await gym.terminal.waitForText(
            "↳ queued Continue after preserving the important details.",
            30_000,
        );
        releaseFirstResponse.resolve();
        const result = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Context compacted") &&
                snapshot.text.includes("KIMI_COMPACTION_CONTINUED") &&
                snapshot.text.includes("kimi-k3 max · /workspace"),
            "Kimi compaction and continuation",
            30_000,
        );
        expect(result.text).not.toContain("Create a detailed continuation brief");
        expect(agentCallIndex).toBe(3);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function usage(input: number, output: number) {
    return {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input,
        output,
        totalTokens: input + output,
    };
}

function lastUserText(context: {
    messages: readonly {
        role: string;
        content?: string | readonly { type: string; text?: string }[];
    }[];
}): string {
    const message = context.messages.at(-1);
    if (message?.role !== "user") return "";
    if (typeof message.content === "string") return message.content;
    return (message.content ?? [])
        .flatMap((block) => (block.type === "text" && block.text !== undefined ? [block.text] : []))
        .join("");
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
