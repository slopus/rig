import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";

import { runAgentLoop, type AgentLoopEvent } from "./loop.js";
import { defineTool } from "./types.js";
import { createJustBashToolHarness } from "../tools/testing/createJustBashToolHarness.js";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type AssistantMessageEvent,
    type Context,
    type InferenceStream,
} from "../providers/types.js";

describe("Code Mode nested tool calling", () => {
    it("exposes only exec while nested calls re-enter the normal execution pipeline", async () => {
        const model = defineModel({
            id: "mock/code-mode",
            name: "Code Mode",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const contexts: Context[] = [];
        let iteration = 0;
        const provider = defineProvider({
            id: "mock",
            models: [model],
            stream(_model, context) {
                contexts.push(context);
                iteration += 1;
                return streamFor(
                    iteration === 1
                        ? message(model.id, "toolUse", [
                              {
                                  type: "toolCall",
                                  kind: "custom",
                                  id: "exec-call|exec-item",
                                  name: "exec",
                                  arguments: { input: "await tools.inspect({value: 7})" },
                              },
                          ])
                        : message(model.id, "stop", [{ type: "text", text: "done" }]),
                );
            },
        });
        const nestedExecute = vi.fn(({ value }: { value: number }) => ({ value: value * 2 }));
        const nested = defineTool({
            name: "inspect",
            label: "Inspect",
            description: "Inspect a value.",
            arguments: Type.Object({ value: Type.Number() }),
            returnType: Type.Object({ value: Type.Number() }),
            shouldReviewInAutoMode: () => false,
            execute: nestedExecute,
            toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
            toUI: (result) => JSON.stringify(result),
            locks: [],
        });
        const exec = defineTool({
            name: "exec",
            label: "exec",
            description: "Run JavaScript.",
            providerTool: { kind: "custom", name: "exec", description: "Run JavaScript." },
            arguments: Type.Object({ input: Type.String() }),
            returnType: Type.Object({ value: Type.Number() }),
            shouldReviewInAutoMode: () => false,
            execute: async (_args, _context, options) => {
                if (options.invokeTool === undefined) throw new Error("missing nested dispatch");
                return (await options.invokeTool({
                    name: "inspect",
                    arguments: { value: 7 },
                    toolCallId: "nested-inspect",
                })) as { value: number };
            },
            toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
            toUI: (result) => JSON.stringify(result),
            locks: [],
        });
        const events: AgentLoopEvent[] = [];
        const harness = createJustBashToolHarness();

        const result = await runAgentLoop({
            provider,
            modelId: model.id,
            tools: [exec],
            nestedTools: [nested],
            promptTools: [nested],
            messages: [{ role: "user", id: "user", blocks: [{ type: "text", text: "run" }] }],
            context: harness.context,
            onEvent: (event) => {
                events.push(event);
            },
        });

        expect(result.stopReason).toBe("stop");
        expect(nestedExecute).toHaveBeenCalledOnce();
        expect(contexts[0]?.tools).toEqual([
            { kind: "custom", name: "exec", description: "Run JavaScript." },
        ]);
        expect(events.filter((event) => event.type === "tool_execution_start")).toHaveLength(2);
        expect(JSON.stringify(result.messages)).toContain('"toolName":"exec"');
        expect(JSON.stringify(result.messages)).not.toContain('"toolName":"inspect"');
    });

    it.each([
        { namespace: "collaboration", executes: true },
        { namespace: undefined, executes: false },
        { namespace: "other", executes: false },
    ])(
        "dispatches a collaboration member only for its declared namespace: $namespace",
        async ({ namespace, executes }) => {
            const model = defineModel({
                id: "mock/namespaced-tools",
                name: "Namespaced tools",
                thinkingLevels: ["off"],
                defaultThinkingLevel: "off",
            });
            const contexts: Context[] = [];
            let iteration = 0;
            const provider = defineProvider({
                id: "mock",
                models: [model],
                stream(_model, context) {
                    contexts.push(context);
                    iteration += 1;
                    return streamFor(
                        iteration === 1
                            ? message(model.id, "toolUse", [
                                  {
                                      type: "toolCall",
                                      id: `spawn-${namespace ?? "missing"}`,
                                      name: "spawn_agent",
                                      ...(namespace === undefined ? {} : { namespace }),
                                      arguments: { task_name: "audit" },
                                  },
                              ])
                            : message(model.id, "stop", [{ type: "text", text: "done" }]),
                    );
                },
            });
            const spawn = vi.fn(() => ({ agent_id: "agent-1" }));
            const collaborationMember = {
                ...defineTool({
                    name: "spawn_agent",
                    label: "Spawn agent",
                    description: "Spawn a subagent.",
                    arguments: Type.Object({ task_name: Type.String() }),
                    returnType: Type.Object({ agent_id: Type.String() }),
                    shouldReviewInAutoMode: () => false,
                    execute: spawn,
                    toLLM: (result) => [{ type: "text" as const, text: JSON.stringify(result) }],
                    toUI: () => "Spawned agent",
                    locks: [],
                }),
                codeMode: { namespace: "collaboration" },
            };
            const collaborationNamespace = defineTool({
                name: "collaboration",
                label: "Collaboration",
                description: "Collaboration tools.",
                providerTool: {
                    kind: "namespace",
                    name: "collaboration",
                    description: "Collaboration tools.",
                    tools: [
                        {
                            name: collaborationMember.name,
                            description: collaborationMember.description,
                            parameters: collaborationMember.arguments,
                        },
                    ],
                },
                arguments: Type.Object({}),
                returnType: Type.Unknown(),
                shouldReviewInAutoMode: () => false,
                execute: () => {
                    throw new Error("namespace container must not execute");
                },
                toLLM: () => [],
                toUI: () => "Collaboration",
                locks: [],
            });
            const harness = createJustBashToolHarness();

            const result = await runAgentLoop({
                provider,
                modelId: model.id,
                tools: [collaborationNamespace],
                nestedTools: [collaborationMember],
                promptTools: [collaborationMember],
                messages: [{ role: "user", id: "user", blocks: [{ type: "text", text: "run" }] }],
                context: harness.context,
            });

            expect(result.stopReason).toBe("stop");
            expect(spawn).toHaveBeenCalledTimes(executes ? 1 : 0);
            const toolResult = result.messages
                .flatMap((entry) => (entry.role === "agent" ? entry.blocks : []))
                .find((block) => block.type === "tool_result");
            expect(toolResult).toMatchObject(
                executes
                    ? { type: "tool_result", toolName: "spawn_agent" }
                    : {
                          type: "tool_result",
                          toolName: "spawn_agent",
                          isError: true,
                          failure: { kind: "tool_unavailable" },
                      },
            );
            const roundTrippedCall = contexts[1]?.messages
                .flatMap((entry) => (entry.role === "assistant" ? entry.content : []))
                .find((content) => content.type === "toolCall");
            expect(roundTrippedCall).toMatchObject({
                name: "spawn_agent",
                ...(namespace === undefined ? {} : { namespace }),
            });
            expect(roundTrippedCall?.namespace).toBe(namespace);
        },
    );
});

function message(
    model: string,
    stopReason: AssistantMessage["stopReason"],
    content: AssistantMessage["content"],
): AssistantMessage {
    return {
        role: "assistant",
        content,
        api: "mock",
        provider: "mock",
        model,
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason,
        timestamp: Date.now(),
    };
}

function streamFor(message: AssistantMessage): InferenceStream {
    return {
        async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
            yield { type: "start", partial: message };
            if (message.stopReason === "toolUse") {
                for (let index = 0; index < message.content.length; index += 1) {
                    const content = message.content[index];
                    if (content?.type !== "toolCall") continue;
                    yield { type: "toolcall_start", contentIndex: index, partial: message };
                    yield {
                        type: "toolcall_end",
                        contentIndex: index,
                        toolCall: content,
                        partial: message,
                    };
                }
            }
            yield {
                type: "done",
                reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
                message,
            };
        },
        result: async () => message,
    };
}
