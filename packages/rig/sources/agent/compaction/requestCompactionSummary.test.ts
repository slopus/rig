import { describe, expect, it } from "vitest";

import { createInferenceStream } from "../../providers/createInferenceStream.js";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type InferenceStream,
} from "../../providers/types.js";
import { requestCompactionSummary } from "./requestCompactionSummary.js";

const model = defineModel({
    id: "openai/test",
    name: "Test",
    thinkingLevels: ["off"],
    defaultThinkingLevel: "off",
});

describe("requestCompactionSummary", () => {
    it("retries a transport failure before summary content begins", async () => {
        let requests = 0;
        const provider = defineProvider({
            id: "test",
            models: [model],
            stream() {
                requests += 1;
                return requests === 1
                    ? streamThrowingBeforeContent(new TypeError("fetch failed"))
                    : textStream("Recovered summary.");
            },
        });

        await expect(
            requestCompactionSummary({
                messages: messagesToCompact(),
                model,
                now: () => 1,
                provider,
            }),
        ).resolves.toBe("Recovered summary.");
        expect(requests).toBe(2);
    });

    it("does not retry a transport failure after summary content begins", async () => {
        let requests = 0;
        const provider = defineProvider({
            id: "test",
            models: [model],
            stream() {
                requests += 1;
                return streamThrowingAfterText(new Error("WebSocket error"));
            },
        });

        await expect(
            requestCompactionSummary({
                messages: messagesToCompact(),
                model,
                now: () => 1,
                provider,
            }),
        ).rejects.toThrow("WebSocket error");
        expect(requests).toBe(1);
    });

    it("does not retry an HTTP response or provider retry guidance", async () => {
        for (const errorMessage of [
            "Provider returned HTTP 503",
            "An error occurred while processing your request. You can retry your request.",
        ]) {
            let requests = 0;
            const provider = defineProvider({
                id: "test",
                models: [model],
                stream() {
                    requests += 1;
                    return errorStream(errorMessage);
                },
            });

            await expect(
                requestCompactionSummary({
                    messages: messagesToCompact(),
                    model,
                    now: () => 1,
                    provider,
                }),
            ).rejects.toThrow(errorMessage);
            expect(requests).toBe(1);
        }
    });
});

function messagesToCompact() {
    return [
        { role: "user" as const, id: "user-1", blocks: [{ type: "text" as const, text: "Work." }] },
        {
            role: "agent" as const,
            id: "agent-1",
            blocks: [{ type: "text" as const, text: "Completed." }],
        },
    ];
}

function streamThrowingBeforeContent(error: Error): InferenceStream {
    return createInferenceStream(async function* () {
        throw error;
    });
}

function streamThrowingAfterText(error: Error): InferenceStream {
    const message = assistantMessage([{ type: "text", text: "Partial summary." }], "error");
    return createInferenceStream(async function* () {
        yield { type: "start", partial: message };
        yield { type: "text_start", contentIndex: 0, partial: message };
        yield { type: "text_delta", contentIndex: 0, delta: "Partial summary.", partial: message };
        throw error;
    });
}

function textStream(text: string): InferenceStream {
    const message = assistantMessage([{ type: "text", text }], "stop");
    return createInferenceStream(async function* () {
        yield { type: "start", partial: message };
        yield { type: "text_start", contentIndex: 0, partial: message };
        yield { type: "text_delta", contentIndex: 0, delta: text, partial: message };
        yield { type: "text_end", contentIndex: 0, content: text, partial: message };
        yield { type: "done", reason: "stop", message };
        return message;
    });
}

function errorStream(errorMessage: string): InferenceStream {
    const message = assistantMessage([], "error", errorMessage);
    return createInferenceStream(async function* () {
        yield { type: "start", partial: message };
        yield { type: "error", reason: "error", error: message };
        return message;
    });
}

function assistantMessage(
    content: AssistantMessage["content"],
    stopReason: AssistantMessage["stopReason"],
    errorMessage?: string,
): AssistantMessage {
    return {
        api: "test",
        content,
        model: model.id,
        provider: "test",
        role: "assistant",
        stopReason,
        timestamp: 1,
        usage: {
            cacheRead: 0,
            cacheWrite: 0,
            cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
            input: 0,
            output: 0,
            totalTokens: 0,
        },
        ...(errorMessage === undefined ? {} : { errorMessage }),
    };
}
