import { describe, expect, it } from "vitest";

import type { Executor } from "@/Executor.js";
import { createExecutorInferenceStream } from "@/createExecutorInferenceStream.js";
import { defineModel } from "@/types.js";

describe("createExecutorInferenceStream", () => {
    it("streams tentative provider blocks and rolls them back on reset", async () => {
        const executor = {
            run: async function* () {
                yield { type: "block_start" } as const;
                yield { type: "reasoning_delta", delta: "considering" } as const;
                yield { type: "text_delta", delta: "tentative" } as const;
                yield {
                    type: "tool_call_start",
                    callId: "tentative-tool",
                    name: "Bash",
                } as const;
                yield {
                    type: "tool_call_delta",
                    callId: "tentative-tool",
                    delta: '{"command":"echo tentative"}',
                } as const;
                yield {
                    type: "tool_call_end",
                    callId: "tentative-tool",
                    arguments: '{"command":"echo tentative"}',
                } as const;
                yield { type: "block_reset" } as const;
                yield { type: "done", state: "cancelled" } as const;
            },
        } as unknown as Executor;
        const stream = createExecutorInferenceStream({
            context: { messages: [] },
            executor,
            model: defineModel({
                id: "anthropic/test",
                name: "Test",
                thinkingLevels: ["off"],
                defaultThinkingLevel: "off",
            }),
            providerId: "claude",
        });
        const events = [];

        for await (const event of stream) events.push(event);

        expect(events.map((event) => event.type)).toEqual([
            "start",
            "thinking_start",
            "thinking_delta",
            "text_start",
            "text_delta",
            "toolcall_start",
            "toolcall_delta",
            "toolcall_end",
            "reset",
            "error",
        ]);
        expect(events.find((event) => event.type === "text_delta")).toMatchObject({
            delta: "tentative",
        });
        expect(events.find((event) => event.type === "thinking_delta")).toMatchObject({
            delta: "considering",
        });
        expect(events.find((event) => event.type === "toolcall_end")).toMatchObject({
            toolCall: {
                id: "tentative-tool",
                name: "Bash",
                arguments: { command: "echo tentative" },
            },
        });
        await expect(stream.result()).resolves.toMatchObject({
            content: [],
            stopReason: "aborted",
        });
    });

    it("preserves a classified provider error and its reset time", async () => {
        const executor = {
            run: async function* () {
                yield {
                    type: "done",
                    state: "error",
                    kind: "billing_error",
                    message: "Claude usage is exhausted.",
                    providerError: { type: "out_of_tokens", resetAt: 2_000_000 },
                } as const;
            },
        } as unknown as Executor;
        const stream = createExecutorInferenceStream({
            context: { messages: [] },
            executor,
            model: defineModel({
                id: "anthropic/test",
                name: "Test",
                thinkingLevels: ["off"],
                defaultThinkingLevel: "off",
            }),
            providerId: "claude",
        });

        for await (const _event of stream) {
            // Consume the stream as the agent loop does.
        }

        await expect(stream.result()).resolves.toMatchObject({
            errorMessage: "Claude usage is exhausted.",
            providerError: { type: "out_of_tokens", resetAt: 2_000_000 },
            stopReason: "error",
        });
    });

    it("preserves a tool-call namespace from the native provider", async () => {
        const executor = {
            run: async function* () {
                yield {
                    type: "tool_call_start",
                    callId: "spawn-call",
                    name: "spawn_agent",
                    namespace: "collaboration",
                } as const;
                yield {
                    type: "tool_call_end",
                    callId: "spawn-call",
                    arguments: '{"task_name":"inspect","message":"Inspect it."}',
                } as const;
                yield { type: "done", state: "tool_call" } as const;
            },
        } as unknown as Executor;
        const stream = createExecutorInferenceStream({
            context: { messages: [] },
            executor,
            model: defineModel({
                id: "openai/test",
                name: "Test",
                thinkingLevels: ["off"],
                defaultThinkingLevel: "off",
            }),
            providerId: "codex",
        });

        for await (const _event of stream) {
            // Consume the stream as the agent loop does.
        }

        await expect(stream.result()).resolves.toMatchObject({
            content: [
                {
                    type: "toolCall",
                    id: "spawn-call",
                    name: "spawn_agent",
                    namespace: "collaboration",
                },
            ],
            stopReason: "toolUse",
        });
    });
});
