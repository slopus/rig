import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";

import { codexViewImageTool } from "../tools/codex/view_image.js";
import { createJustBashToolHarness } from "../tools/testing/createJustBashToolHarness.js";
import { validPng32Base64 } from "../tools/testing/validImageFixtures.js";
import { Agent } from "./Agent.js";
import { defineTool, type Message } from "./types.js";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type Context,
    type InferenceStream,
    type Usage,
} from "../providers/types.js";

describe("Agent", () => {
    it("queues steering and user messages, runs the loop, and prints messages", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off", "high"],
            defaultThinkingLevel: "off",
        });
        const contexts: Context[] = [];
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream(_model, context) {
                contexts.push(context);
                return streamFor({
                    role: "assistant",
                    content: [{ type: "text", text: "agent-done" }],
                    api: "test",
                    provider: "codex",
                    model: "openai/gpt-test",
                    usage: zeroUsage(),
                    stopReason: "stop",
                    timestamp: 1,
                });
            },
        });
        const logs: unknown[][] = [];
        const observedEvents: string[] = [];
        const observedMessages: string[] = [];
        const harness = createJustBashToolHarness();
        const agent = new Agent({
            provider,
            modelId: "openai/gpt-test",
            context: harness.context,
            instructions: "Base instructions.",
            idFactory: createDeterministicIds(),
            now: () => 1,
            console: {
                log(...data) {
                    logs.push(data);
                },
            },
            onEvent(event) {
                observedEvents.push(event.type);
            },
            onMessage(message) {
                observedMessages.push(message.id);
            },
        });

        const steering = agent.addSteering("Keep answers short.");
        const user = agent.enqueueUserMessage("Say done.");
        const queuedIds = agent.queue.map((entry) => entry.id);

        expect(agent.id).toBe("id-1");
        expect(steering.id).toBe("id-2");
        expect(user.id).toBe("id-4");
        expect(queuedIds).toEqual(["id-3", "id-5"]);

        const result = await agent.run();

        expect(result.runId).toBe("id-6");
        expect(result.stopReason).toBe("stop");
        expect(agent.status).toBe("idle");
        expect(agent.queue).toEqual([]);
        expect(agent.messages.map((message) => message.id)).toEqual(["id-2", "id-4", "id-7"]);
        expect(contexts[0]?.systemPrompt).toBe("Base instructions.\n\nKeep answers short.");
        expect(logs.map((entry) => entry[0])).toEqual([
            "[system:id-2] Keep answers short.",
            "[user:id-4] Say done.",
            "[agent:id-7] agent-done",
        ]);
        expect(observedEvents).toEqual(["inference_iteration_start", "start", "done"]);
        expect(observedMessages).toEqual(["id-7"]);
    });

    it("selects codex tools for GPT models and allows explicit tool overrides", () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream() {
                return streamFor({
                    role: "assistant",
                    content: [],
                    api: "test",
                    provider: "codex",
                    model: "openai/gpt-test",
                    usage: zeroUsage(),
                    stopReason: "stop",
                    timestamp: 1,
                });
            },
        });
        const harness = createJustBashToolHarness();

        const defaultAgent = new Agent({
            provider,
            modelId: "openai/gpt-test",
            context: harness.context,
            printToConsole: false,
        });
        expect(defaultAgent.tools.map((tool) => tool.name)).toEqual([
            "exec_command",
            "write_stdin",
            "apply_patch",
            "view_image",
            "update_plan",
            "request_user_input",
        ]);

        const noopTool = defineTool({
            name: "noop",
            label: "Noop",
            description: "Does nothing.",
            arguments: Type.Object({}),
            returnType: Type.Object({ ok: Type.Boolean() }),
            execute: () => ({ ok: true }),
            toLLM: () => [{ type: "text", text: "ok" }],
            toUI: () => "ok",
            locks: [],
        });
        const overrideAgent = new Agent({
            provider,
            modelId: "openai/gpt-test",
            context: harness.context,
            tools: [noopTool],
            printToConsole: false,
        });

        expect(overrideAgent.tools.map((tool) => tool.name)).toEqual(["noop"]);
    });

    it("switches model and reasoning effort", () => {
        const smallModel = defineModel({
            id: "openai/gpt-small",
            name: "GPT Small",
            thinkingLevels: ["low", "medium"],
            defaultThinkingLevel: "low",
        });
        const proModel = defineModel({
            id: "openai/gpt-pro",
            name: "GPT Pro",
            thinkingLevels: ["low", "high"],
            defaultThinkingLevel: "low",
        });
        const provider = defineProvider({
            id: "codex",
            models: [smallModel, proModel],
            stream() {
                return streamFor({
                    role: "assistant",
                    content: [],
                    api: "test",
                    provider: "codex",
                    model: "openai/gpt-pro",
                    usage: zeroUsage(),
                    stopReason: "stop",
                    timestamp: 1,
                });
            },
        });
        const harness = createJustBashToolHarness();
        const agent = new Agent({
            provider,
            modelId: smallModel.id,
            context: harness.context,
            printToConsole: false,
        });

        agent.setModel(proModel.id, "high");

        expect(agent.model.id).toBe(proModel.id);
        expect(agent.snapshot().modelId).toBe(proModel.id);
        expect(agent.snapshot().effort).toBe("high");
    });

    it("automatically compacts model context while preserving the visible transcript", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
            contextWindow: 100,
        });
        const contexts: Context[] = [];
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream(_model, context) {
                contexts.push(context);
                const isCompaction = context.systemPrompt?.startsWith(
                    "Create a detailed continuation brief",
                );
                return streamFor({
                    role: "assistant",
                    content: [
                        {
                            type: "text",
                            text: isCompaction ? "Earlier work was summarized." : "continued",
                        },
                    ],
                    api: "test",
                    provider: "codex",
                    model: model.id,
                    usage: zeroUsage(),
                    stopReason: "stop",
                    timestamp: 1,
                });
            },
        });
        const messages: Message[] = [
            {
                role: "user",
                id: "user-old",
                blocks: [{ type: "text", text: "A".repeat(180) }],
            },
            {
                role: "agent",
                id: "agent-old",
                blocks: [{ type: "text", text: "B".repeat(180) }],
            },
        ];
        const harness = createJustBashToolHarness();
        const agent = new Agent({
            provider,
            modelId: model.id,
            context: harness.context,
            messages,
            idFactory: createDeterministicIds(),
            printToConsole: false,
        });

        await agent.send("Continue from there.");

        expect(contexts).toHaveLength(2);
        expect(contexts[0]?.tools).toEqual([]);
        expect(contexts[1]?.messages).toMatchObject([
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: expect.stringContaining("Earlier work was summarized."),
                    },
                ],
            },
            {
                role: "user",
                content: [{ type: "text", text: "Continue from there." }],
            },
        ]);
        expect(agent.snapshot().messages).toMatchObject([
            { id: "user-old" },
            { id: "agent-old" },
            { role: "user" },
            { role: "agent", blocks: [{ type: "text", text: "continued" }] },
        ]);
        expect(agent.snapshot().contextMessages).toHaveLength(3);
    });

    it("manually compacts completed history without removing transcript messages", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream(_model, context) {
                const isCompaction = context.systemPrompt?.startsWith(
                    "Create a detailed continuation brief",
                );
                return streamFor({
                    role: "assistant",
                    content: [{ type: "text", text: isCompaction ? "Brief." : "done" }],
                    api: "test",
                    provider: "codex",
                    model: model.id,
                    usage: zeroUsage(),
                    stopReason: "stop",
                    timestamp: 1,
                });
            },
        });
        const harness = createJustBashToolHarness();
        const agent = new Agent({
            provider,
            modelId: model.id,
            context: harness.context,
            printToConsole: false,
        });
        await agent.send("Do the work.");
        const visibleMessages = agent.snapshot().messages;

        const result = await agent.compact();

        expect(result).toMatchObject({
            compacted: true,
            compactedMessageCount: 2,
            retainedMessageCount: 0,
        });
        expect(agent.snapshot().messages).toEqual(visibleMessages);
        expect(agent.snapshot().contextMessages).toMatchObject([
            {
                role: "user",
                blocks: [{ type: "text", text: expect.stringContaining("Brief.") }],
            },
        ]);
    });

    it("resets transcript and queued messages", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream() {
                return streamFor({
                    role: "assistant",
                    content: [{ type: "text", text: "done" }],
                    api: "test",
                    provider: "codex",
                    model: "openai/gpt-test",
                    usage: zeroUsage(),
                    stopReason: "stop",
                    timestamp: 1,
                });
            },
        });
        const harness = createJustBashToolHarness();
        const agent = new Agent({
            provider,
            modelId: model.id,
            context: harness.context,
            printToConsole: false,
        });

        await agent.send("hello");
        agent.enqueueUserMessage("queued");
        expect(agent.snapshot().messages.length).toBeGreaterThan(0);
        expect(agent.snapshot().queue.length).toBe(1);

        agent.reset();

        expect(agent.status).toBe("idle");
        expect(agent.snapshot().messages).toEqual([]);
        expect(agent.snapshot().queue).toEqual([]);
        expect(agent.snapshot().lastRunId).toBeUndefined();
    });

    it("recovers when the provider rejects a locally valid image tool result", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const contexts: Context[] = [];
        let requestCount = 0;
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream(_model, context) {
                contexts.push(context);
                requestCount += 1;
                if (requestCount === 1) {
                    return streamFor({
                        role: "assistant",
                        content: [
                            {
                                type: "toolCall",
                                id: "call-image",
                                name: "view_image",
                                arguments: { path: "/workspace/valid-image.png" },
                            },
                        ],
                        api: "test",
                        provider: "codex",
                        model: model.id,
                        usage: zeroUsage(),
                        stopReason: "toolUse",
                        timestamp: 1,
                    });
                }
                if (requestCount === 2) {
                    return streamFor({
                        role: "assistant",
                        content: [],
                        api: "test",
                        provider: "codex",
                        model: model.id,
                        usage: zeroUsage(),
                        stopReason: "error",
                        errorCode: "invalid_image_request",
                        errorMessage: `Codex error:
{"type":"error","error":{"type":"invalid_request_error","code":"invalid_value","message":"The image data you provided does not represent a valid image.","param":"input"},"status":400}`,
                        timestamp: 2,
                    });
                }
                return streamFor({
                    role: "assistant",
                    content: [{ type: "text", text: "recovered" }],
                    api: "test",
                    provider: "codex",
                    model: model.id,
                    usage: zeroUsage(),
                    stopReason: "stop",
                    timestamp: 3,
                });
            },
        });
        const observedEventTypes: string[] = [];
        const observedToolResults: Message[] = [];
        const harness = createJustBashToolHarness();
        await harness.context.fs.writeFile(
            "/workspace/valid-image.png",
            Buffer.from(validPng32Base64, "base64"),
        );
        const agent = new Agent({
            provider,
            modelId: model.id,
            context: harness.context,
            tools: [codexViewImageTool],
            printToConsole: false,
            onEvent: (event) => {
                observedEventTypes.push(event.type);
            },
            onMessage: (message) => {
                if (
                    message.role === "agent" &&
                    message.blocks.some((block) => block.type === "tool_result")
                ) {
                    observedToolResults.push(message);
                }
            },
        });

        const result = await agent.send("Inspect the image.");

        expect(result.stopReason).toBe("stop");
        expect(contexts).toHaveLength(3);
        expect(contexts[1]?.messages.at(-1)).toMatchObject({
            role: "toolResult",
            content: [
                {
                    type: "image",
                    mimeType: "image/png",
                    data: validPng32Base64,
                },
            ],
        });
        expect(contexts[2]?.messages.at(-1)).toMatchObject({
            role: "toolResult",
            content: [{ type: "text", text: "Invalid image" }],
            isError: false,
        });
        expect(observedEventTypes).not.toContain("error");
        expect(observedToolResults).toHaveLength(2);
        expect(observedToolResults[1]?.id).toBe(observedToolResults[0]?.id);
        expect(result.messages.at(-1)).toMatchObject({
            role: "agent",
            blocks: [{ type: "text", text: "recovered" }],
        });
    });

    it("keeps transcript valid after aborting during tool execution", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const contexts: Context[] = [];
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream(_model, context) {
                contexts.push(context);
                if (contexts.length === 1) {
                    return streamFor({
                        role: "assistant",
                        content: [
                            {
                                type: "toolCall",
                                id: "call-wait",
                                name: "wait",
                                arguments: { value: "hold" },
                            },
                        ],
                        api: "test",
                        provider: "codex",
                        model: "openai/gpt-test",
                        usage: zeroUsage(),
                        stopReason: "toolUse",
                        timestamp: 1,
                    });
                }

                return streamFor({
                    role: "assistant",
                    content: [{ type: "text", text: "next done" }],
                    api: "test",
                    provider: "codex",
                    model: "openai/gpt-test",
                    usage: zeroUsage(),
                    stopReason: "stop",
                    timestamp: 2,
                });
            },
        });
        const controller = new AbortController();
        const started = deferred<void>();
        const waitTool = defineTool({
            name: "wait",
            label: "Wait",
            description: "Waits until aborted.",
            arguments: Type.Object({ value: Type.String() }),
            returnType: Type.Object({ value: Type.String() }),
            async execute(args: { value: string }, _context, execution) {
                started.resolve();
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
        const agent = new Agent({
            provider,
            modelId: model.id,
            context: harness.context,
            tools: [waitTool],
            printToConsole: false,
        });

        const abortedRun = agent.send("start tool", { signal: controller.signal });
        await started.promise;
        controller.abort();
        await abortedRun;

        expect(agent.messages.at(-1)).toMatchObject({
            role: "agent",
            blocks: [
                {
                    type: "tool_result",
                    toolCallId: "call-wait",
                    toolName: "wait",
                    rendered: [{ type: "text", text: "Interrupted by user." }],
                    isError: true,
                },
            ],
        });

        await agent.send("next message");

        expect(contexts[1]?.messages).toMatchObject([
            { role: "user" },
            {
                role: "assistant",
                content: [
                    {
                        type: "toolCall",
                        id: "call-wait",
                        name: "wait",
                    },
                ],
            },
            {
                role: "toolResult",
                toolCallId: "call-wait",
                toolName: "wait",
                content: [{ type: "text", text: "Interrupted by user." }],
                isError: true,
            },
            { role: "user" },
        ]);
    });

    it("does not allow reset to start an overlapping in-flight run", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const started = deferred<void>();
        const release = deferred<void>();
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream() {
                return streamAfterRelease(started.resolve, release.promise);
            },
        });
        const harness = createJustBashToolHarness();
        const agent = new Agent({
            provider,
            modelId: model.id,
            context: harness.context,
            printToConsole: false,
        });

        const firstRun = agent.send("first");
        await started.promise;

        agent.reset();

        expect(agent.status).toBe("running");
        await expect(agent.send("second")).rejects.toThrow("already running");

        release.resolve();
        await firstRun;

        expect(agent.status).toBe("idle");
        expect(agent.messages).toEqual([]);
        expect(agent.queue).toEqual([]);
    });
});

function createDeterministicIds(): () => string {
    let next = 0;
    return () => `id-${++next}`;
}

function streamFor(message: AssistantMessage): InferenceStream {
    return {
        async *[Symbol.asyncIterator]() {
            yield {
                type: "start" as const,
                partial: message,
            };
            if (message.stopReason === "error" || message.stopReason === "aborted") {
                yield {
                    type: "error" as const,
                    reason: message.stopReason,
                    error: message,
                };
                return;
            }
            yield {
                type: "done" as const,
                reason: message.stopReason,
                message,
            };
        },
        async result() {
            return message;
        },
    };
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

function streamAfterRelease(started: () => void, release: Promise<void>): InferenceStream {
    const message: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        api: "test",
        provider: "codex",
        model: "openai/gpt-test",
        usage: zeroUsage(),
        stopReason: "stop",
        timestamp: 1,
    };

    return {
        async *[Symbol.asyncIterator]() {
            yield { type: "start" as const, partial: message };
            started();
            await release;
            yield { type: "done" as const, reason: "stop" as const, message };
        },
        async result() {
            await release;
            return message;
        },
    };
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
