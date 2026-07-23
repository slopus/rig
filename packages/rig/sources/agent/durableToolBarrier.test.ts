import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";

import { runAgentLoop } from "./loop.js";
import { defineTool } from "./types.js";
import { createJustBashToolHarness } from "../tools/testing/createJustBashToolHarness.js";
import { createPermissionContext } from "../permissions/index.js";
import type { Message } from "./types.js";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type AssistantMessageEvent,
    type InferenceStream,
} from "@slopus/rig-execution";

describe("durable tool execution barriers", () => {
    it("finishes immediate calls before publishing durable calls from the same batch", async () => {
        const order: string[] = [];
        let inferenceCount = 0;
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "mock/model",
            name: "Mock",
            thinkingLevels: ["off"],
        });
        const provider = defineProvider({
            id: "mock",
            models: [model],
            stream() {
                inferenceCount += 1;
                return streamFor(
                    inferenceCount === 1
                        ? message([
                              {
                                  arguments: {},
                                  id: "durable-first",
                                  name: "external",
                                  type: "toolCall",
                              },
                              {
                                  arguments: {},
                                  id: "immediate-second",
                                  name: "local",
                                  type: "toolCall",
                              },
                          ])
                        : message([{ text: "done", type: "text" }], "stop"),
                );
            },
        });
        const local = defineTool({
            arguments: Type.Object({}),
            description: "Local action",
            execute: () => {
                order.push("local");
                return "local-result";
            },
            label: "Local",
            locks: [],
            name: "local",
            returnType: Type.String(),
            shouldReviewInAutoMode: () => false,
            toLLM: (result) => [{ text: result, type: "text" }],
            toUI: () => "Local completed",
        });
        const external = defineTool({
            arguments: Type.Object({}),
            description: "Durable action",
            execution: "durable",
            execute: () => {
                order.push("durable");
                return "external-result";
            },
            label: "External",
            locks: [],
            name: "external",
            returnType: Type.String(),
            shouldReviewInAutoMode: () => false,
            toLLM: (result) => [{ text: result, type: "text" }],
            toUI: () => "External completed",
        });
        const harness = createJustBashToolHarness();

        const result = await runAgentLoop({
            context: harness.context,
            messages: [{ blocks: [{ text: "Run both", type: "text" }], id: "user", role: "user" }],
            modelId: model.id,
            provider,
            tools: [local, external],
        });

        expect(order).toEqual(["local", "durable"]);
        expect(result.messages.slice(2, 4).map((entry) => entry.role)).toEqual(["agent", "agent"]);
        expect(result.messages[2]).toMatchObject({
            blocks: [{ toolCallId: "immediate-second", type: "tool_result" }],
        });
        expect(result.messages[3]).toMatchObject({
            blocks: [{ toolCallId: "durable-first", type: "tool_result" }],
        });
    });

    it("commits immediate sibling results before a reviewed call waits for permission", async () => {
        const observedMessages: Message[] = [];
        let mainCalls = 0;
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "mock/model",
            name: "Mock",
            thinkingLevels: ["off"],
        });
        const provider = defineProvider({
            id: "mock",
            models: [model],
            stream(_model, context) {
                if (context.systemPrompt?.includes("independent permission reviewer")) {
                    return streamFor(
                        message(
                            [
                                {
                                    text: JSON.stringify({
                                        decision: "ask",
                                        reason: "The action needs approval.",
                                        risk: "high",
                                        user_authorization: "low",
                                    }),
                                    type: "text",
                                },
                            ],
                            "stop",
                        ),
                    );
                }
                mainCalls += 1;
                return streamFor(
                    mainCalls === 1
                        ? message([
                              {
                                  arguments: {},
                                  id: "reviewed-first",
                                  name: "reviewed",
                                  type: "toolCall",
                              },
                              {
                                  arguments: {},
                                  id: "local-second",
                                  name: "local",
                                  type: "toolCall",
                              },
                          ])
                        : message([{ text: "done", type: "text" }], "stop"),
                );
            },
        });
        const local = defineTool({
            arguments: Type.Object({}),
            description: "Local action",
            execute: () => "local-result",
            label: "Local",
            locks: [],
            name: "local",
            returnType: Type.String(),
            shouldReviewInAutoMode: () => false,
            toLLM: (result) => [{ text: result, type: "text" }],
            toUI: () => "Local completed",
        });
        const reviewed = defineTool({
            arguments: Type.Object({}),
            description: "Reviewed action",
            describeAutoPermissionAction: () => "run the reviewed action",
            execute: () => "should-not-run",
            label: "Reviewed",
            locks: [],
            name: "reviewed",
            returnType: Type.String(),
            shouldReviewInAutoMode: () => true,
            toLLM: (result) => [{ text: result, type: "text" }],
            toUI: () => "Reviewed action completed",
        });
        const harness = createJustBashToolHarness();
        harness.context.permissions = createPermissionContext("auto");
        harness.context.userInput = {
            request: async () => {
                expect(
                    observedMessages.some(
                        (entry) =>
                            entry.role === "agent" &&
                            entry.blocks.some(
                                (block) =>
                                    block.type === "tool_result" &&
                                    block.toolCallId === "local-second",
                            ),
                    ),
                ).toBe(true);
                return { answers: { permission: ["Deny"] } };
            },
        };

        await runAgentLoop({
            context: harness.context,
            messages: [{ blocks: [{ text: "Run both", type: "text" }], id: "user", role: "user" }],
            modelId: model.id,
            onMessage: (entry) => {
                observedMessages.push(entry);
            },
            provider,
            tools: [local, reviewed],
        });

        const resultMessages = observedMessages.filter(
            (entry) => entry.role === "agent" && entry.blocks[0]?.type === "tool_result",
        );
        expect(resultMessages).toHaveLength(2);
        expect(resultMessages[0]).toMatchObject({
            blocks: [{ toolCallId: "local-second" }],
        });
        expect(resultMessages[1]).toMatchObject({
            blocks: [{ isError: true, toolCallId: "reviewed-first" }],
        });
    });

    it("publishes every permission prompt before waiting on shared execution locks", async () => {
        const requests: string[] = [];
        const answers: Array<(answer: { answers: { permission: string[] } }) => void> = [];
        let mainCalls = 0;
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "mock/model",
            name: "Mock",
            thinkingLevels: ["off"],
        });
        const provider = defineProvider({
            id: "mock",
            models: [model],
            stream(_model, context) {
                if (context.systemPrompt?.includes("independent permission reviewer")) {
                    return streamFor(
                        message(
                            [
                                {
                                    text: JSON.stringify({
                                        decision: "ask",
                                        reason: "The action needs approval.",
                                        risk: "high",
                                        user_authorization: "low",
                                    }),
                                    type: "text",
                                },
                            ],
                            "stop",
                        ),
                    );
                }
                mainCalls += 1;
                return streamFor(
                    mainCalls === 1
                        ? message([
                              {
                                  arguments: { value: "first" },
                                  id: "reviewed-first",
                                  name: "reviewed",
                                  type: "toolCall",
                              },
                              {
                                  arguments: { value: "second" },
                                  id: "reviewed-second",
                                  name: "reviewed",
                                  type: "toolCall",
                              },
                          ])
                        : message([{ text: "done", type: "text" }], "stop"),
                );
            },
        });
        const reviewed = defineTool({
            arguments: Type.Object({ value: Type.String() }),
            description: "Reviewed action",
            describeAutoPermissionAction: ({ value }) => `run ${value}`,
            execute: ({ value }) => value,
            label: "Reviewed",
            locks: ["shared"],
            name: "reviewed",
            returnType: Type.String(),
            shouldReviewInAutoMode: () => true,
            toLLM: (result) => [{ text: result, type: "text" }],
            toUI: () => "Reviewed action completed",
        });
        const harness = createJustBashToolHarness();
        harness.context.permissions = createPermissionContext("auto");
        harness.context.userInput = {
            request: (request) => {
                requests.push(request.requestId);
                return new Promise((resolve) => answers.push(resolve));
            },
        };

        const running = runAgentLoop({
            context: harness.context,
            messages: [{ blocks: [{ text: "Run both", type: "text" }], id: "user", role: "user" }],
            modelId: model.id,
            provider,
            tools: [reviewed],
        });

        await vi.waitFor(() => expect(requests).toHaveLength(2));
        expect(requests).toEqual(["reviewed-first:permission", "reviewed-second:permission"]);
        for (const answer of answers) answer({ answers: { permission: ["Deny"] } });
        await running;
    });
});

function message(
    content: AssistantMessage["content"],
    stopReason: AssistantMessage["stopReason"] = "toolUse",
): AssistantMessage {
    return {
        api: "mock",
        content,
        model: "mock/model",
        provider: "mock",
        role: "assistant",
        stopReason,
        timestamp: 0,
        usage: {
            cacheRead: 0,
            cacheWrite: 0,
            cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
            input: 0,
            output: 0,
            totalTokens: 0,
        },
    };
}

function streamFor(message: AssistantMessage): InferenceStream {
    return {
        async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
            yield { partial: message, type: "start" };
            if (message.stopReason === "toolUse" || message.stopReason === "stop") {
                yield { message, reason: message.stopReason, type: "done" };
            }
        },
        result: async () => message,
    };
}
