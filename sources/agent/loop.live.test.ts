import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";

import { runAgentLoop } from "./loop.js";
import { defineTool } from "./types.js";
import { createJustBashToolHarness } from "../tools/testing/createJustBashToolHarness.js";
import {
    defineModel,
    defineProvider,
    type AssistantContent,
    type AssistantMessage,
    type AssistantMessageEvent,
    type Context,
    type InferenceStream,
    type StopReason,
    type StreamOptions,
    type Usage,
} from "../providers/types.js";

describe("agent loop live", () => {
    it("executes mock tools and feeds rendered tool answers back to the model", async () => {
        const model = defineModel({
            id: "mock/model",
            name: "Mock Model",
            thinkingLevels: ["off", "high"],
            defaultThinkingLevel: "off",
        });
        const contexts: Context[] = [];
        const streamOptions: StreamOptions[] = [];

        const provider = defineProvider({
            id: "mock",
            models: [model],
            stream(_model, context, options) {
                contexts.push(context);
                if (options !== undefined) {
                    streamOptions.push(options);
                }

                if (contexts.length === 1) {
                    return streamFor(
                        assistantMessage(
                            [
                                {
                                    type: "toolCall",
                                    id: "call-add",
                                    name: "add",
                                    arguments: { left: 2, right: 5 },
                                },
                                {
                                    type: "toolCall",
                                    id: "call-shout",
                                    name: "shout",
                                    arguments: { value: "dublin" },
                                },
                            ],
                            "toolUse",
                        ),
                    );
                }

                return streamFor(
                    assistantMessage(
                        [
                            {
                                type: "text",
                                text: "done",
                            },
                        ],
                        "stop",
                    ),
                );
            },
        });

        const addExecute = vi.fn((args: { left: number; right: number }) => ({
            total: args.left + args.right,
        }));
        const addToLLM = vi.fn((result: { total: number }) => [
            {
                type: "text" as const,
                text: `total=${result.total}`,
            },
        ]);
        const addToUI = vi.fn((result: { total: number }) => `added ${result.total}`);
        const addTool = defineTool({
            name: "add",
            label: "Add",
            description: "Adds two numbers.",
            arguments: Type.Object({
                left: Type.Number(),
                right: Type.Number(),
            }),
            returnType: Type.Object({
                total: Type.Number(),
            }),
            execute: addExecute,
            toLLM: addToLLM,
            toUI: addToUI,
            locks: [],
        });

        const shoutExecute = vi.fn((args: { value: string }) => ({
            shouted: args.value.toUpperCase(),
        }));
        const shoutToLLM = vi.fn((result: { shouted: string }) => [
            {
                type: "text" as const,
                text: result.shouted,
            },
        ]);
        const shoutToUI = vi.fn((result: { shouted: string }) => `shouted ${result.shouted}`);
        const shoutTool = defineTool({
            name: "shout",
            label: "Shout",
            description: "Uppercases text.",
            arguments: Type.Object({
                value: Type.String(),
            }),
            returnType: Type.Object({
                shouted: Type.String(),
            }),
            execute: shoutExecute,
            toLLM: shoutToLLM,
            toUI: shoutToUI,
            locks: [],
        });

        let nextId = 0;
        let timestamp = 1_000;
        const harness = createJustBashToolHarness();
        const result = await runAgentLoop({
            provider,
            modelId: "mock/model",
            effort: "high",
            tools: [addTool, shoutTool],
            instructions: "Use tools when needed.",
            messages: [
                {
                    role: "user",
                    id: "user-1",
                    blocks: [
                        {
                            type: "text",
                            text: "Add 2 and 5, then shout dublin.",
                        },
                    ],
                },
            ],
            idFactory: () => `generated-${++nextId}`,
            now: () => timestamp++,
            context: harness.context,
        });

        expect(result.stopReason).toBe("stop");
        expect(contexts).toHaveLength(2);
        expect(streamOptions).toHaveLength(2);
        expect(streamOptions[0]?.thinking).toBe("high");

        expect(contexts[0]?.systemPrompt).toBe("Use tools when needed.");
        expect(contexts[0]?.tools?.map((tool) => tool.name)).toEqual(["add", "shout"]);

        expect(addExecute).toHaveBeenCalledExactlyOnceWith(
            {
                left: 2,
                right: 5,
            },
            expect.objectContaining({
                fs: expect.objectContaining({ cwd: "/workspace" }),
                bash: expect.objectContaining({ cwd: "/workspace" }),
            }),
            {
                onProgress: expect.any(Function),
                toolCallId: "call-add",
            },
        );
        expect(addToLLM).toHaveBeenCalledExactlyOnceWith({ total: 7 });
        expect(addToUI).toHaveBeenCalledExactlyOnceWith(
            { total: 7 },
            {
                left: 2,
                right: 5,
            },
        );
        expect(shoutExecute).toHaveBeenCalledExactlyOnceWith(
            { value: "dublin" },
            expect.objectContaining({
                fs: expect.objectContaining({ cwd: "/workspace" }),
                bash: expect.objectContaining({ cwd: "/workspace" }),
            }),
            {
                onProgress: expect.any(Function),
                toolCallId: "call-shout",
            },
        );
        expect(shoutToLLM).toHaveBeenCalledExactlyOnceWith({
            shouted: "DUBLIN",
        });
        expect(shoutToUI).toHaveBeenCalledExactlyOnceWith(
            {
                shouted: "DUBLIN",
            },
            { value: "dublin" },
        );

        expect(contexts[1]?.messages).toHaveLength(4);
        expect(contexts[1]?.messages[2]).toMatchObject({
            role: "toolResult",
            toolCallId: "call-add",
            toolName: "add",
            content: [{ type: "text", text: "total=7" }],
            isError: false,
        });
        expect(contexts[1]?.messages[3]).toMatchObject({
            role: "toolResult",
            toolCallId: "call-shout",
            toolName: "shout",
            content: [{ type: "text", text: "DUBLIN" }],
            isError: false,
        });

        expect(result.messages).toHaveLength(4);
        expect(result.messages[2]).toMatchObject({
            role: "agent",
            blocks: [
                {
                    type: "tool_result",
                    toolCallId: "call-add",
                    toolName: "add",
                    rendered: [{ type: "text", text: "total=7" }],
                    display: "added 7",
                },
                {
                    type: "tool_result",
                    toolCallId: "call-shout",
                    toolName: "shout",
                    rendered: [{ type: "text", text: "DUBLIN" }],
                    display: "shouted DUBLIN",
                },
            ],
        });
    });

    it("executes provider tool calls in parallel and preserves result order", async () => {
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

                if (contexts.length === 1) {
                    return streamFor(
                        assistantMessage(
                            [
                                {
                                    type: "toolCall",
                                    id: "call-slow",
                                    name: "slow",
                                    arguments: { value: "slow" },
                                },
                                {
                                    type: "toolCall",
                                    id: "call-fast",
                                    name: "fast",
                                    arguments: { value: "fast" },
                                },
                            ],
                            "toolUse",
                        ),
                    );
                }

                return streamFor(assistantMessage([{ type: "text", text: "done" }], "stop"));
            },
        });

        const events: string[] = [];
        const slowTool = defineTool({
            name: "slow",
            label: "Slow",
            description: "Returns slowly.",
            arguments: Type.Object({ value: Type.String() }),
            returnType: Type.Object({ value: Type.String() }),
            async execute(args: { value: string }) {
                events.push("slow-start");
                await delay(40);
                events.push("slow-end");
                return args;
            },
            toLLM(result: { value: string }) {
                return [{ type: "text", text: result.value }];
            },
            toUI(result: { value: string }) {
                return `finished ${result.value}`;
            },
            locks: [],
        });
        const fastTool = defineTool({
            name: "fast",
            label: "Fast",
            description: "Returns quickly.",
            arguments: Type.Object({ value: Type.String() }),
            returnType: Type.Object({ value: Type.String() }),
            async execute(args: { value: string }) {
                events.push("fast-start");
                await delay(1);
                events.push("fast-end");
                return args;
            },
            toLLM(result: { value: string }) {
                return [{ type: "text", text: result.value }];
            },
            toUI(result: { value: string }) {
                return `finished ${result.value}`;
            },
            locks: [],
        });

        const harness = createJustBashToolHarness();
        const executionEvents: string[] = [];
        const result = await runAgentLoop({
            provider,
            modelId: "mock/model",
            tools: [slowTool, fastTool],
            messages: [
                {
                    role: "user",
                    id: "user-1",
                    blocks: [{ type: "text", text: "Run both tools." }],
                },
            ],
            context: harness.context,
            onEvent(event) {
                if (event.type === "tool_execution_start") {
                    executionEvents.push(`start:${event.toolCall.id}`);
                }
                if (event.type === "tool_execution_end") {
                    executionEvents.push(`end:${event.result.toolCallId}`);
                }
            },
        });

        expect(result.stopReason).toBe("stop");
        expect(events.indexOf("fast-start")).toBeGreaterThan(events.indexOf("slow-start"));
        expect(events.indexOf("fast-start")).toBeLessThan(events.indexOf("slow-end"));
        expect(executionEvents).toEqual([
            "start:call-slow",
            "start:call-fast",
            "end:call-fast",
            "end:call-slow",
        ]);
        expect(contexts[1]?.messages.slice(2)).toMatchObject([
            {
                role: "toolResult",
                toolCallId: "call-slow",
                toolName: "slow",
                content: [{ type: "text", text: "slow" }],
            },
            {
                role: "toolResult",
                toolCallId: "call-fast",
                toolName: "fast",
                content: [{ type: "text", text: "fast" }],
            },
        ]);
        expect(result.messages[2]).toMatchObject({
            role: "agent",
            blocks: [
                {
                    type: "tool_result",
                    toolCallId: "call-slow",
                    toolName: "slow",
                    rendered: [{ type: "text", text: "slow" }],
                    display: "finished slow",
                },
                {
                    type: "tool_result",
                    toolCallId: "call-fast",
                    toolName: "fast",
                    rendered: [{ type: "text", text: "fast" }],
                    display: "finished fast",
                },
            ],
        });
    });

    it("passes the abort signal to active tool calls and omits results after abort", async () => {
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
                return streamFor(
                    assistantMessage(
                        [
                            {
                                type: "toolCall",
                                id: "call-wait",
                                name: "wait",
                                arguments: { value: "hold" },
                            },
                        ],
                        "toolUse",
                    ),
                );
            },
        });

        const controller = new AbortController();
        const started = deferred<void>();
        const observedSignals: boolean[] = [];
        const waitTool = defineTool({
            name: "wait",
            label: "Wait",
            description: "Waits until the run is aborted.",
            arguments: Type.Object({ value: Type.String() }),
            returnType: Type.Object({ value: Type.String() }),
            async execute(args: { value: string }, _context, execution) {
                observedSignals.push(execution.signal === controller.signal);
                started.resolve();
                if (execution.signal === undefined) {
                    throw new Error("Missing abort signal.");
                }

                await new Promise<void>((resolve) => {
                    execution.signal?.addEventListener("abort", () => resolve(), {
                        once: true,
                    });
                });
                return args;
            },
            toLLM(result: { value: string }) {
                return [{ type: "text", text: result.value }];
            },
            toUI(result: { value: string }) {
                return `finished ${result.value}`;
            },
            locks: [],
        });

        const harness = createJustBashToolHarness();
        const resultPromise = runAgentLoop({
            provider,
            modelId: "mock/model",
            tools: [waitTool],
            messages: [
                {
                    role: "user",
                    id: "user-1",
                    blocks: [{ type: "text", text: "Run a waiting tool." }],
                },
            ],
            context: harness.context,
            signal: controller.signal,
        });

        await started.promise;
        controller.abort();

        const result = await resultPromise;
        expect(observedSignals).toEqual([true]);
        expect(result.stopReason).toBe("aborted");
        expect(result.messages).toHaveLength(3);
        expect(result.messages[2]).toMatchObject({
            role: "agent",
            blocks: [
                {
                    type: "tool_result",
                    toolCallId: "call-wait",
                    toolName: "wait",
                    rendered: [{ type: "text", text: "Interrupted by user." }],
                    display: "Interrupted by user.",
                    isError: true,
                },
            ],
        });
    });
});

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
} {
    let resolve: (value: T | PromiseLike<T>) => void = () => {};
    const promise = new Promise<T>((innerResolve) => {
        resolve = innerResolve;
    });
    return { promise, resolve };
}

function streamFor(message: AssistantMessage): InferenceStream {
    const doneReason = toDoneReason(message.stopReason);

    return {
        async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
            yield {
                type: "start",
                partial: message,
            };
            yield {
                type: "done",
                reason: doneReason,
                message,
            };
        },
        result: async () => message,
    };
}

function assistantMessage(
    content: readonly AssistantContent[],
    stopReason: StopReason,
): AssistantMessage {
    return {
        role: "assistant",
        content,
        api: "mock",
        provider: "mock",
        model: "mock/model",
        usage: zeroUsage(),
        stopReason,
        timestamp: 0,
    };
}

function toDoneReason(reason: StopReason): Extract<StopReason, "stop" | "length" | "toolUse"> {
    if (reason === "stop" || reason === "length" || reason === "toolUse") {
        return reason;
    }

    throw new Error(`Cannot create done event for stop reason '${reason}'`);
}

function zeroUsage(): Usage {
    return {
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
    };
}
