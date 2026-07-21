import { describe, expect, it } from "vitest";
import { Type } from "@sinclair/typebox";

import { createInferenceStream } from "../../providers/createInferenceStream.js";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type Context,
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
    it("preserves the cached wire prefix and appends one summary request", async () => {
        const observedContexts: Context[] = [];
        const context = compactionContext();
        const provider = defineProvider({
            id: "test",
            models: [model],
            stream(_model, requestContext) {
                observedContexts.push(requestContext);
                return textStream("Cached summary.");
            },
        });

        await expect(
            requestCompactionSummary({ context, model, now: () => 4, provider }),
        ).resolves.toBe("Cached summary.");

        expect(observedContexts).toEqual([
            {
                ...context,
                messages: [
                    ...context.messages,
                    {
                        role: "user",
                        content: expect.stringMatching(/^Create a detailed continuation brief/u),
                        timestamp: 4,
                    },
                ],
            },
        ]);
    });

    it("uses provider-native compaction before the manual stream fallback", async () => {
        let streamed = false;
        const provider = defineProvider({
            id: "test",
            models: [model],
            compact(_model, context, options) {
                expect(context).toEqual(compactionContext());
                expect(options.prompt).toMatch(/^Create a detailed continuation brief/u);
                return textStream("Native summary.");
            },
            stream() {
                streamed = true;
                return textStream("Manual summary.");
            },
        });

        await expect(
            requestCompactionSummary({
                context: compactionContext(),
                model,
                now: () => 4,
                provider,
            }),
        ).resolves.toBe("Native summary.");
        expect(streamed).toBe(false);
    });

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
                context: compactionContext(),
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
                context: compactionContext(),
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
                    context: compactionContext(),
                    model,
                    now: () => 1,
                    provider,
                }),
            ).rejects.toThrow(errorMessage);
            expect(requests).toBe(1);
        }
    });
});

function compactionContext(): Context {
    return {
        systemPrompt: "Stable system prompt.",
        tools: [
            {
                name: "read_file",
                description: "Read one file.",
                parameters: Type.Object({}),
            },
        ],
        messages: [
            { role: "user", content: [{ type: "text", text: "Work." }], timestamp: 1 },
            {
                role: "assistant",
                content: [
                    {
                        type: "toolCall",
                        id: "call-1",
                        name: "read_file",
                        arguments: { path: "README.md" },
                    },
                ],
                api: "test",
                provider: "test",
                model: model.id,
                usage: zeroUsage(),
                stopReason: "toolUse",
                timestamp: 2,
            },
            {
                role: "toolResult",
                toolCallId: "call-1",
                toolName: "read_file",
                content: [{ type: "text", text: "Contents." }],
                isError: false,
                timestamp: 3,
            },
        ],
    };
}

function zeroUsage(): AssistantMessage["usage"] {
    return {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
    };
}

function streamThrowingBeforeContent(error: Error): InferenceStream {
    // eslint-disable-next-line require-yield -- This fixture fails before emitting content.
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
        usage: zeroUsage(),
        ...(errorMessage === undefined ? {} : { errorMessage }),
    };
}
