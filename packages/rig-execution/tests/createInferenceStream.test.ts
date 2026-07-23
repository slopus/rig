import { describe, expect, it } from "vitest";

import { createInferenceStream } from "../sources/createInferenceStream.js";

describe("createInferenceStream", () => {
    it("keeps iterator failures observable through result without an unhandled promise", async () => {
        const failure = new Error("scripted provider failure");
        const stream = createInferenceStream(async function* () {
            yield* [];
            throw failure;
        });

        await expect(consume(stream)).rejects.toBe(failure);
        await expect(stream.result()).rejects.toBe(failure);
    });

    it("rejects result when iteration ends before the provider returns a message", async () => {
        let providerStreamClosed = false;
        const stream = createInferenceStream(async function* () {
            try {
                yield { type: "text_delta", contentIndex: 0, delta: "partial", partial: message() };
            } finally {
                providerStreamClosed = true;
            }
            return message();
        });

        for await (const _event of stream) {
            break;
        }

        await expect(stream.result()).rejects.toThrow(
            "Inference stream iteration ended before a result was available.",
        );
        expect(providerStreamClosed).toBe(true);
    });
});

async function consume(stream: AsyncIterable<unknown>): Promise<void> {
    for await (const _event of stream) {
        // Consume the provider boundary exactly as the agent loop does.
    }
}

function message() {
    return {
        role: "assistant" as const,
        content: [],
        api: "test",
        provider: "test",
        model: "test",
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop" as const,
        timestamp: 0,
    };
}
