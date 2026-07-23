import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";

import { runAgentLoop } from "./loop.js";
import { defineTool, type UserMessage } from "./types.js";
import { createJustBashToolHarness } from "../tools/testing/createJustBashToolHarness.js";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type AssistantMessageEvent,
    type Context,
    type InferenceStream,
} from "@slopus/rig-execution";

describe("duplicate tool call identifiers", () => {
    it("rejects an identifier that was already used by an earlier turn", async () => {
        const model = defineModel({
            id: "mock/model",
            name: "Mock Model",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const provider = defineProvider({
            id: "mock",
            models: [model],
            stream() {
                return streamFor({
                    role: "assistant",
                    content: [
                        {
                            type: "toolCall",
                            id: "already-used",
                            name: "machine-action",
                            arguments: { value: "second action" },
                        },
                    ],
                    api: "mock",
                    provider: "mock",
                    model: model.id,
                    usage: {
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                        totalTokens: 0,
                        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                    },
                    stopReason: "toolUse",
                    timestamp: 2,
                });
            },
        });
        const execute = vi.fn((args: { value: string }) => args);
        const tool = defineTool({
            name: "machine-action",
            label: "Machine action",
            description: "Changes the machine.",
            arguments: Type.Object({ value: Type.String() }),
            returnType: Type.Object({ value: Type.String() }),
            shouldReviewInAutoMode: () => false,
            execute,
            toLLM: (result: { value: string }) => [{ type: "text", text: result.value }],
            toUI: (result: { value: string }) => result.value,
            locks: [],
        });
        const harness = createJustBashToolHarness();

        const result = await runAgentLoop({
            provider,
            modelId: model.id,
            tools: [tool],
            messages: [
                { role: "user", id: "user-1", blocks: [{ type: "text", text: "first" }] },
                {
                    role: "agent",
                    id: "assistant-1",
                    blocks: [
                        {
                            type: "tool_call",
                            id: "already-used",
                            name: "machine-action",
                            arguments: { value: "first action" },
                        },
                    ],
                },
                {
                    role: "agent",
                    id: "result-1",
                    blocks: [
                        {
                            type: "tool_result",
                            toolCallId: "already-used",
                            toolName: "machine-action",
                            rendered: [{ type: "text", text: "first action" }],
                            display: "first action",
                        },
                    ],
                },
                { role: "user", id: "user-2", blocks: [{ type: "text", text: "second" }] },
            ],
            context: harness.context,
        });

        expect(result.stopReason).toBe("error");
        expect(execute).not.toHaveBeenCalled();
        expect(JSON.stringify(result.messages)).toContain("No tools were run.");
    });

    it("rejects every action in the ambiguous batch without executing any tool", async () => {
        const model = defineModel({
            id: "mock/model",
            name: "Mock Model",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const contexts: Context[] = [];
        const provider = defineProvider({
            id: "mock",
            models: [model],
            stream(_model, context) {
                contexts.push(context);
                return streamFor({
                    role: "assistant",
                    content: [
                        {
                            type: "toolCall",
                            id: "reused-provider-id",
                            name: "machine-action",
                            arguments: { value: "benign inspection" },
                        },
                        {
                            type: "toolCall",
                            id: "reused-provider-id",
                            name: "machine-action",
                            arguments: { value: "host takeover" },
                        },
                    ],
                    api: "mock",
                    provider: "mock",
                    model: "mock/model",
                    usage: {
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                        totalTokens: 0,
                        cost: {
                            input: 0,
                            output: 0,
                            cacheRead: 0,
                            cacheWrite: 0,
                            total: 0,
                        },
                    },
                    stopReason: "toolUse",
                    timestamp: 0,
                });
            },
        });
        const execute = vi.fn((args: { value: string }) => args);
        const tool = defineTool({
            name: "machine-action",
            label: "Machine action",
            description: "Changes the machine.",
            arguments: Type.Object({ value: Type.String() }),
            returnType: Type.Object({ value: Type.String() }),
            shouldReviewInAutoMode: () => false,
            execute,
            toLLM(result: { value: string }) {
                return [{ type: "text", text: result.value }];
            },
            toUI(result: { value: string }) {
                return result.value;
            },
            locks: [],
        });
        const events: string[] = [];
        let nextId = 0;
        const harness = createJustBashToolHarness();
        const steeringMessage: UserMessage = {
            role: "user",
            id: "steering-1",
            blocks: [{ type: "text", text: "Preserve this direction after rejecting the batch." }],
        };
        let steeringTaken = false;

        const result = await runAgentLoop({
            provider,
            modelId: "mock/model",
            tools: [tool],
            messages: [
                {
                    role: "user",
                    id: "user-1",
                    blocks: [{ type: "text", text: "Inspect the machine safely." }],
                },
            ],
            context: harness.context,
            idFactory: () => `safe-local-${String(++nextId)}`,
            onEvent(event) {
                events.push(event.type);
            },
            takeSteering() {
                if (steeringTaken) return [];
                steeringTaken = true;
                return [steeringMessage];
            },
        });

        expect(execute).not.toHaveBeenCalled();
        expect(contexts).toHaveLength(1);
        expect(result.stopReason).toBe("error");
        expect(events).toContain("tool_batch_rejected");
        expect(events).toContain("steering_applied");
        expect(events).not.toContain("tool_execution_start");
        expect(result.messages).toHaveLength(4);
        expect(result.messages[1]).toMatchObject({
            role: "agent",
            blocks: [
                {
                    type: "tool_call",
                    id: "safe-local-1",
                    name: "machine-action",
                    arguments: { value: "benign inspection" },
                },
                {
                    type: "tool_call",
                    id: "safe-local-2",
                    name: "machine-action",
                    arguments: { value: "host takeover" },
                },
            ],
        });
        expect(result.messages[2]).toMatchObject({
            role: "agent",
            blocks: [
                {
                    type: "tool_result",
                    toolCallId: "safe-local-1",
                    isError: true,
                },
                {
                    type: "tool_result",
                    toolCallId: "safe-local-2",
                    isError: true,
                },
            ],
        });
        expect(result.messages[3]).toEqual(steeringMessage);
        const serializedTranscript = JSON.stringify(result.messages);
        expect(serializedTranscript).toContain(
            "Rig rejected this entire batch of 2 requested actions",
        );
        expect(serializedTranscript).toContain("No tools were run.");
        expect(serializedTranscript).not.toContain("reused-provider-id");
    });
});

function streamFor(message: AssistantMessage): InferenceStream {
    return {
        async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
            yield { type: "start", partial: message };
            yield { type: "done", reason: "toolUse", message };
        },
        result: async () => message,
    };
}
