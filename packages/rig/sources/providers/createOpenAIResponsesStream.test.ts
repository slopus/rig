import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it } from "vitest";

import { createOpenAIResponsesStream } from "./createOpenAIResponsesStream.js";

describe("createOpenAIResponsesStream", () => {
    it("normalizes reasoning, text, and tool calls for every Responses API provider", async () => {
        const stream = createOpenAIResponsesStream({
            createResponseStream: () =>
                responseEvents(
                    {
                        type: "response.created",
                        response: { id: "response-1", model: "api-model" },
                    },
                    {
                        type: "response.output_item.added",
                        output_index: 0,
                        item: { type: "reasoning", id: "reasoning-1", summary: [] },
                    },
                    {
                        type: "response.reasoning_summary_text.delta",
                        output_index: 0,
                        delta: "Working",
                    },
                    {
                        type: "response.output_item.done",
                        output_index: 0,
                        item: {
                            type: "reasoning",
                            id: "reasoning-1",
                            summary: [{ type: "summary_text", text: "Working" }],
                        },
                    },
                    {
                        type: "response.output_item.added",
                        output_index: 1,
                        item: {
                            type: "message",
                            id: "message-1",
                            role: "assistant",
                            status: "in_progress",
                            content: [],
                        },
                    },
                    { type: "response.output_text.delta", output_index: 1, delta: "Done" },
                    {
                        type: "response.output_item.done",
                        output_index: 1,
                        item: {
                            type: "message",
                            id: "message-1",
                            role: "assistant",
                            status: "completed",
                            content: [
                                {
                                    type: "output_text",
                                    text: "Done",
                                    annotations: [],
                                },
                            ],
                        },
                    },
                    {
                        type: "response.output_item.added",
                        output_index: 2,
                        item: {
                            type: "function_call",
                            id: "function-1",
                            call_id: "call-1",
                            name: "inspect",
                            arguments: "",
                        },
                    },
                    {
                        type: "response.function_call_arguments.delta",
                        output_index: 2,
                        delta: '{"path":"file',
                    },
                    {
                        type: "response.function_call_arguments.done",
                        output_index: 2,
                        arguments: '{"path":"file.ts"}',
                    },
                    {
                        type: "response.output_item.done",
                        output_index: 2,
                        item: {
                            type: "function_call",
                            id: "function-1",
                            call_id: "call-1",
                            name: "inspect",
                            arguments: '{"path":"file.ts"}',
                        },
                    },
                    {
                        type: "response.completed",
                        response: {
                            id: "response-1",
                            model: "api-model",
                            status: "completed",
                            usage: {
                                input_tokens: 5,
                                input_tokens_details: {
                                    cached_tokens: 1,
                                    cache_write_tokens: 1,
                                },
                                output_tokens: 3,
                                total_tokens: 8,
                            },
                        },
                    },
                ),
            failureMessage: "Provider failed.",
            modelId: "catalog-model",
            providerId: "custom-provider",
        });

        await expect(stream.result()).resolves.toMatchObject({
            content: [
                { type: "thinking", thinking: "Working" },
                { type: "text", text: "Done", textSignature: "message-1" },
                {
                    type: "toolCall",
                    id: "call-1|function-1",
                    name: "inspect",
                    arguments: { path: "file.ts" },
                },
            ],
            model: "catalog-model",
            provider: "custom-provider",
            responseId: "response-1",
            responseModel: "api-model",
            stopReason: "toolUse",
            usage: { cacheRead: 1, cacheWrite: 1, input: 3, output: 3, totalTokens: 8 },
        });
    });

    it("normalizes streamed custom tool source as a freeform tool call", async () => {
        const stream = createOpenAIResponsesStream({
            createResponseStream: () =>
                responseEvents(
                    {
                        type: "response.created",
                        response: { id: "response-code", model: "gpt-5.6-sol" },
                    },
                    {
                        type: "response.output_item.added",
                        output_index: 0,
                        item: {
                            type: "custom_tool_call",
                            id: "custom-1",
                            call_id: "call-code",
                            name: "exec",
                            input: "",
                        },
                    },
                    {
                        type: "response.custom_tool_call_input.delta",
                        output_index: 0,
                        item_id: "custom-1",
                        delta: "const result = await tools.exec_command(",
                    },
                    {
                        type: "response.custom_tool_call_input.done",
                        output_index: 0,
                        item_id: "custom-1",
                        input: 'const result = await tools.exec_command({cmd: "pwd"});',
                    },
                    {
                        type: "response.output_item.done",
                        output_index: 0,
                        item: {
                            type: "custom_tool_call",
                            id: "custom-1",
                            call_id: "call-code",
                            name: "exec",
                            input: 'const result = await tools.exec_command({cmd: "pwd"});',
                        },
                    },
                    {
                        type: "response.completed",
                        response: {
                            id: "response-code",
                            model: "gpt-5.6-sol",
                            status: "completed",
                            usage: {
                                input_tokens: 2,
                                input_tokens_details: { cached_tokens: 0 },
                                output_tokens: 1,
                                total_tokens: 3,
                            },
                        },
                    },
                ),
            failureMessage: "Codex failed.",
            modelId: "openai/gpt-5.6-sol",
            providerId: "codex",
        });

        await expect(stream.result()).resolves.toMatchObject({
            content: [
                {
                    type: "toolCall",
                    id: "call-code|custom-1",
                    kind: "custom",
                    name: "exec",
                    arguments: {
                        input: 'const result = await tools.exec_command({cmd: "pwd"});',
                    },
                },
            ],
            stopReason: "toolUse",
        });
    });

    it("preserves the namespace on streamed function tool calls", async () => {
        const stream = createOpenAIResponsesStream({
            createResponseStream: () =>
                responseEvents(
                    {
                        type: "response.output_item.added",
                        output_index: 0,
                        item: {
                            type: "function_call",
                            id: "function-1",
                            call_id: "call-function",
                            namespace: "collaboration",
                            name: "spawn_agent",
                            arguments: "",
                        },
                    },
                    {
                        type: "response.output_item.done",
                        output_index: 0,
                        item: {
                            type: "function_call",
                            id: "function-1",
                            call_id: "call-function",
                            namespace: "collaboration",
                            name: "spawn_agent",
                            arguments: '{"task_name":"audit"}',
                        },
                    },
                    {
                        type: "response.completed",
                        response: {
                            id: "response-function",
                            model: "gpt-5.6-sol",
                            status: "completed",
                            usage: {
                                input_tokens: 2,
                                input_tokens_details: { cached_tokens: 0 },
                                output_tokens: 1,
                                total_tokens: 3,
                            },
                        },
                    },
                ),
            failureMessage: "Codex failed.",
            modelId: "openai/gpt-5.6-sol",
            providerId: "codex",
        });

        await expect(stream.result()).resolves.toMatchObject({
            content: [
                {
                    type: "toolCall",
                    id: "call-function|function-1",
                    namespace: "collaboration",
                    name: "spawn_agent",
                    arguments: { task_name: "audit" },
                },
            ],
            stopReason: "toolUse",
        });
    });

    it("uses the provider failure message and preserves aborts", async () => {
        const failed = createOpenAIResponsesStream({
            createResponseStream: () =>
                responseEvents({
                    type: "response.failed",
                    response: { error: null, incomplete_details: null },
                }),
            failureMessage: "Custom provider failed.",
            modelId: "model",
            providerId: "provider",
        });
        await expect(failed.result()).resolves.toMatchObject({
            errorMessage: "Custom provider failed.",
            stopReason: "error",
        });

        const controller = new AbortController();
        controller.abort();
        const aborted = createOpenAIResponsesStream({
            createResponseStream: () => {
                throw new Error("Request aborted");
            },
            failureMessage: "Custom provider failed.",
            modelId: "model",
            providerId: "provider",
            signal: controller.signal,
        });
        await expect(aborted.result()).resolves.toMatchObject({
            errorMessage: "Request aborted",
            stopReason: "aborted",
        });
    });
});

function responseEvents(...events: readonly unknown[]): AsyncIterable<ResponseStreamEvent> {
    return {
        async *[Symbol.asyncIterator]() {
            for (const event of events) yield event as ResponseStreamEvent;
        },
    };
}
