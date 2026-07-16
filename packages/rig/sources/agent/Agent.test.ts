import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";

import { codexViewImageTool } from "../tools/codex/view_image.js";
import { createJustBashToolHarness } from "../tools/testing/createJustBashToolHarness.js";
import { validPng32Base64 } from "../tools/testing/validImageFixtures.js";
import { getImageProcessor } from "../tools/utils/getImageProcessor.js";
import { Agent } from "./Agent.js";
import { defineTool, type Message } from "./types.js";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type Context,
    type InferenceStream,
    type StreamOptions,
    type Usage,
} from "../providers/types.js";
import type { DebugLog } from "../debug/index.js";

describe("Agent", () => {
    it("uses the provider image profile independently of its identifier", async () => {
        const model = defineModel({
            id: "anthropic/claude-test",
            name: "Claude Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const contexts: Context[] = [];
        const provider = defineProvider({
            id: "custom-bedrock",
            imageProfile: () => "claude",
            models: [model],
            stream(_model, context) {
                contexts.push(context);
                return streamFor({
                    role: "assistant",
                    content: [{ type: "text", text: "done" }],
                    api: "test",
                    provider: "custom-bedrock",
                    model: model.id,
                    usage: zeroUsage(),
                    stopReason: "stop",
                    timestamp: 1,
                });
            },
        });
        const sharp = await getImageProcessor();
        const image = await sharp({
            create: {
                width: 2400,
                height: 1200,
                channels: 3,
                background: { r: 30, g: 60, b: 90 },
            },
        })
            .png()
            .toBuffer();
        const harness = createJustBashToolHarness();
        const agent = new Agent({
            provider,
            modelId: model.id,
            context: harness.context,
            printToConsole: false,
        });

        await agent.send([
            {
                type: "image",
                data: image.toString("base64"),
                mediaType: "image/png",
            },
        ]);

        const userMessage = contexts[0]?.messages[0];
        if (userMessage?.role !== "user" || typeof userMessage.content === "string") {
            throw new Error("The provider did not receive the image message.");
        }
        const preparedImage = userMessage.content[0];
        if (preparedImage?.type !== "image") {
            throw new Error("The provider image was omitted.");
        }
        const metadata = await sharp(Buffer.from(preparedImage.data, "base64")).metadata();
        expect(metadata).toMatchObject({ width: 2000, height: 1000 });
    });

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

        const debug = {
            directory: "/tmp/rig-agent-debug",
            record: async () => undefined,
        } as unknown as DebugLog;
        const result = await agent.run({ debug });

        expect(result.runId).toBe("id-6");
        expect(result.debugDirectory).toBe("/tmp/rig-agent-debug");
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
            shouldReviewInAutoMode: () => false,
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

    it("sends the selected service tier and preserves it across model changes", async () => {
        const firstModel = defineModel({
            id: "openai/gpt-first",
            name: "GPT First",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const secondModel = defineModel({
            id: "openai/gpt-second",
            name: "GPT Second",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const streamOptions: (StreamOptions | undefined)[] = [];
        const provider = defineProvider({
            id: "codex",
            models: [firstModel, secondModel],
            serviceTiers: ["fast"],
            stream(model, _context, options) {
                streamOptions.push(options);
                return streamFor({
                    role: "assistant",
                    content: [{ type: "text", text: "done" }],
                    api: "test",
                    provider: "codex",
                    model: model.id,
                    usage: zeroUsage(),
                    stopReason: "stop",
                    timestamp: 1,
                });
            },
        });
        const agent = new Agent({
            provider,
            modelId: firstModel.id,
            context: createJustBashToolHarness().context,
            serviceTier: "fast",
            printToConsole: false,
        });

        agent.setModel(secondModel.id, undefined);
        await agent.send("Use fast inference.");

        expect(agent.snapshot().serviceTier).toBe("fast");
        expect(streamOptions).toMatchObject([{ serviceTier: "fast" }]);

        agent.setServiceTier(undefined);
        expect(agent.snapshot().serviceTier).toBeUndefined();
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

    it.each([
        ["reported provider usage", "tool result", 90],
        ["the local tool-result estimate", "X".repeat(300), 0],
    ])(
        "automatically compacts between tool iterations based on %s",
        async (_trigger, toolResult, reportedTokens) => {
            const model = defineModel({
                id: "openai/gpt-test",
                name: "GPT Test",
                thinkingLevels: ["off"],
                defaultThinkingLevel: "off",
                contextWindow: 100,
            });
            const contexts: Context[] = [];
            const echoTool = defineTool({
                name: "echo",
                label: "Echo",
                description: "Returns the supplied value.",
                arguments: Type.Object({ value: Type.String() }),
                returnType: Type.Object({ value: Type.String() }),
                shouldReviewInAutoMode: () => false,
                execute: (args: { value: string }) => args,
                toLLM: (result: { value: string }) => [{ type: "text", text: result.value }],
                toUI: (result: { value: string }) => result.value,
                locks: [],
            });
            const provider = defineProvider({
                id: "codex",
                models: [model],
                stream(_model, context) {
                    contexts.push(context);
                    const isCompaction = context.systemPrompt?.startsWith(
                        "Create a detailed continuation brief",
                    );
                    if (contexts.length === 1) {
                        return streamFor({
                            role: "assistant",
                            content: [
                                {
                                    type: "toolCall",
                                    id: "call-echo",
                                    name: "echo",
                                    arguments: { value: toolResult },
                                },
                            ],
                            api: "test",
                            provider: "codex",
                            model: model.id,
                            usage: usageWithTotalTokens(reportedTokens),
                            stopReason: "toolUse",
                            timestamp: 1,
                        });
                    }
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
                        timestamp: 2,
                    });
                },
            });
            const messages: Message[] = [
                {
                    role: "user",
                    id: "user-old",
                    blocks: [{ type: "text", text: "Earlier request." }],
                },
                {
                    role: "agent",
                    id: "agent-old",
                    blocks: [{ type: "text", text: "Earlier response." }],
                },
            ];
            const harness = createJustBashToolHarness();
            const agent = new Agent({
                provider,
                modelId: model.id,
                context: harness.context,
                messages,
                tools: [echoTool],
                idFactory: createDeterministicIds(),
                printToConsole: false,
            });

            const result = await agent.send("Continue with the tool.");

            expect(result.stopReason).toBe("stop");
            expect(contexts).toHaveLength(3);
            expect(contexts[1]?.systemPrompt).toMatch(/^Create a detailed continuation brief/u);
            expect(contexts[1]?.tools).toEqual([]);
            expect(contexts[2]?.messages).toMatchObject([
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
                    content: [{ type: "text", text: "Continue with the tool." }],
                },
                {
                    role: "assistant",
                    content: [{ type: "toolCall", id: "call-echo", name: "echo" }],
                },
                {
                    role: "toolResult",
                    toolCallId: "call-echo",
                    content: [{ type: "text", text: toolResult }],
                },
            ]);
            expect(agent.snapshot().messages.slice(0, 2)).toEqual(messages);
            expect(agent.snapshot().contextMessages).toHaveLength(5);
        },
    );

    it("compacts and retries when the provider rejects an overlong context", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
            contextWindow: 100,
        });
        const contexts: Context[] = [];
        const observedEventTypes: string[] = [];
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream(_model, context) {
                contexts.push(context);
                const isCompaction = context.systemPrompt?.startsWith(
                    "Create a detailed continuation brief",
                );
                if (contexts.length === 1) {
                    return streamFor({
                        role: "assistant",
                        content: [],
                        api: "test",
                        provider: "codex",
                        model: model.id,
                        usage: zeroUsage(),
                        stopReason: "error",
                        errorMessage:
                            "Codex error: Your input exceeds the context window of this model. Please adjust your input and try again.",
                        timestamp: 1,
                    });
                }
                return streamFor({
                    role: "assistant",
                    content: [
                        {
                            type: "text",
                            text: isCompaction ? "Earlier work was summarized." : "recovered",
                        },
                    ],
                    api: "test",
                    provider: "codex",
                    model: model.id,
                    usage: zeroUsage(),
                    stopReason: "stop",
                    timestamp: 2,
                });
            },
        });
        const messages: Message[] = [
            {
                role: "user",
                id: "user-old",
                blocks: [{ type: "text", text: "A".repeat(40) }],
            },
            {
                role: "agent",
                id: "agent-old",
                blocks: [{ type: "text", text: "B".repeat(40) }],
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
            onEvent: (event) => {
                observedEventTypes.push(event.type);
            },
        });

        const result = await agent.send("Continue after compacting.");

        expect(result.stopReason).toBe("stop");
        expect(contexts).toHaveLength(3);
        expect(contexts[1]?.systemPrompt).toMatch(/^Create a detailed continuation brief/u);
        expect(contexts[2]?.messages).toMatchObject([
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
                content: [{ type: "text", text: "Continue after compacting." }],
            },
        ]);
        expect(observedEventTypes).not.toContain("error");
        expect(result.messages).not.toContainEqual(
            expect.objectContaining({ role: "agent", blocks: [] }),
        );
        expect(result.messages.at(-1)).toMatchObject({
            role: "agent",
            blocks: [{ type: "text", text: "recovered" }],
        });
    });

    it("retries transient provider errors without ending the turn", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        let requestCount = 0;
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream() {
                requestCount += 1;
                return streamFor({
                    role: "assistant",
                    content: requestCount === 1 ? [] : [{ type: "text", text: "recovered" }],
                    api: "test",
                    provider: "codex",
                    model: model.id,
                    usage: zeroUsage(),
                    stopReason: requestCount === 1 ? "error" : "stop",
                    ...(requestCount === 1 ? { errorMessage: "fetch failed" } : {}),
                    timestamp: requestCount,
                });
            },
        });
        const observedEventTypes: string[] = [];
        const harness = createJustBashToolHarness();
        const agent = new Agent({
            provider,
            modelId: model.id,
            context: harness.context,
            printToConsole: false,
            onEvent: (event) => {
                observedEventTypes.push(event.type);
            },
        });

        agent.enqueueUserMessage("Continue without manual intervention.");
        const result = await agent.run();

        expect(result.stopReason).toBe("stop");
        expect(requestCount).toBe(2);
        expect(observedEventTypes).toEqual(["inference_iteration_start", "start", "done"]);
        expect(agent.messages.at(-1)).toMatchObject({
            role: "agent",
            blocks: [{ type: "text", text: "recovered" }],
        });
    });

    it("manually compacts with the active reasoning and service tier without changing history", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off", "low", "high"],
            defaultThinkingLevel: "low",
        });
        const compactionThinking: (string | undefined)[] = [];
        const compactionServiceTiers: (string | undefined)[] = [];
        const provider = defineProvider({
            id: "codex",
            models: [model],
            serviceTiers: ["fast"],
            stream(_model, context, options) {
                const isCompaction = context.systemPrompt?.startsWith(
                    "Create a detailed continuation brief",
                );
                if (isCompaction) {
                    compactionThinking.push(options?.thinking);
                    compactionServiceTiers.push(options?.serviceTier);
                }
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
            effort: "high",
            serviceTier: "fast",
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
        expect(compactionThinking).toEqual(["high"]);
        expect(compactionServiceTiers).toEqual(["fast"]);
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
            shouldReviewInAutoMode: () => false,
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
        await agent.steer("pending tool direction");
        controller.abort();
        await abortedRun;

        expect(agent.messages.at(-2)).toMatchObject({
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
        expect(agent.messages.at(-1)).toMatchObject({
            role: "user",
            blocks: [{ type: "text", text: "pending tool direction" }],
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
            { role: "user", content: [{ type: "text", text: "pending tool direction" }] },
            { role: "user" },
        ]);
    });

    it("preserves a tool result when aborting after execution completes", async () => {
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
                    content: [
                        {
                            type: "toolCall",
                            id: "call-complete",
                            name: "complete",
                            arguments: { value: "real result" },
                        },
                    ],
                    api: "test",
                    provider: "codex",
                    model: model.id,
                    usage: zeroUsage(),
                    stopReason: "toolUse",
                    timestamp: 1,
                });
            },
        });
        const completeTool = defineTool({
            name: "complete",
            label: "Complete",
            description: "Completes immediately.",
            arguments: Type.Object({ value: Type.String() }),
            returnType: Type.Object({ value: Type.String() }),
            shouldReviewInAutoMode: () => false,
            execute(args: { value: string }) {
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
        const controller = new AbortController();
        const harness = createJustBashToolHarness();
        const agent = new Agent({
            provider,
            modelId: model.id,
            context: harness.context,
            tools: [completeTool],
            printToConsole: false,
            onEvent(event) {
                if (event.type === "tool_execution_end") controller.abort();
            },
        });

        const result = await agent.send("run the tool", { signal: controller.signal });

        expect(result.stopReason).toBe("aborted");
        expect(result.messages.at(-1)).toMatchObject({
            role: "agent",
            blocks: [
                {
                    type: "tool_result",
                    toolCallId: "call-complete",
                    rendered: [{ type: "text", text: "real result" }],
                    display: "finished real result",
                },
            ],
        });
    });

    it("emits structured tool failure details independently of display wording", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        let requestCount = 0;
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream() {
                requestCount += 1;
                return streamFor({
                    role: "assistant",
                    content:
                        requestCount === 1
                            ? [
                                  {
                                      type: "toolCall",
                                      id: "call-failing",
                                      name: "failing",
                                      arguments: {},
                                  },
                              ]
                            : [{ type: "text", text: "done" }],
                    api: "test",
                    provider: "codex",
                    model: model.id,
                    usage: zeroUsage(),
                    stopReason: requestCount === 1 ? "toolUse" : "stop",
                    timestamp: requestCount,
                });
            },
        });
        const failingTool = defineTool({
            name: "failing",
            label: "Failing",
            description: "Fails with a test error.",
            arguments: Type.Object({}),
            returnType: Type.Object({}),
            shouldReviewInAutoMode: () => false,
            execute() {
                throw new Error("test cause");
            },
            toLLM: () => [],
            toUI: () => "unused",
            locks: [],
        });
        const toolResults: unknown[] = [];
        const harness = createJustBashToolHarness();
        const agent = new Agent({
            provider,
            modelId: model.id,
            context: harness.context,
            tools: [failingTool],
            printToConsole: false,
            onEvent(event) {
                if (event.type === "tool_execution_end") toolResults.push(event.result);
            },
        });

        await agent.send("run the failing tool");

        expect(toolResults).toEqual([
            expect.objectContaining({
                display: "Tool 'failing' failed: test cause",
                failure: { kind: "execution_failed", message: "test cause" },
                isError: true,
                toolCallId: "call-failing",
            }),
        ]);
    });

    it("commits pending steering when inference is aborted", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const controller = new AbortController();
        const started = deferred<void>();
        const contexts: Context[] = [];
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream(_model, context, options) {
                contexts.push(context);
                if (contexts.length === 1) {
                    const message: AssistantMessage = {
                        role: "assistant",
                        content: [],
                        api: "test",
                        provider: "codex",
                        model: model.id,
                        usage: zeroUsage(),
                        stopReason: "aborted",
                        timestamp: 1,
                    };
                    return {
                        async *[Symbol.asyncIterator]() {
                            started.resolve();
                            await new Promise<void>((resolve) => {
                                options?.signal?.addEventListener("abort", () => resolve(), {
                                    once: true,
                                });
                            });
                            throw new Error("aborted");
                        },
                        async result() {
                            return message;
                        },
                    };
                }
                return streamFor({
                    role: "assistant",
                    content: [{ type: "text", text: "continued" }],
                    api: "test",
                    provider: "codex",
                    model: model.id,
                    usage: zeroUsage(),
                    stopReason: "stop",
                    timestamp: 2,
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

        const firstRun = agent.send("initial", { signal: controller.signal });
        await started.promise;
        await agent.steer("pending direction");
        controller.abort();

        await expect(firstRun).resolves.toMatchObject({ stopReason: "aborted" });
        expect(
            agent.messages.filter(
                (message) =>
                    message.role === "user" &&
                    message.blocks.some(
                        (block) => block.type === "text" && block.text === "pending direction",
                    ),
            ),
        ).toHaveLength(1);

        await agent.send("continue");

        const continuedUserText = contexts[1]?.messages.flatMap((message) =>
            message.role === "user" && typeof message.content !== "string"
                ? message.content.flatMap((block) => (block.type === "text" ? [block.text] : []))
                : [],
        );
        expect(continuedUserText?.filter((text) => text === "pending direction")).toHaveLength(1);
        expect(continuedUserText?.filter((text) => text === "continue")).toHaveLength(1);
    });

    it("commits pending steering when inference ends with an error", async () => {
        const model = defineModel({
            id: "openai/gpt-test",
            name: "GPT Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const started = deferred<void>();
        const release = deferred<void>();
        const errorMessage: AssistantMessage = {
            role: "assistant",
            content: [],
            api: "test",
            provider: "codex",
            model: model.id,
            usage: zeroUsage(),
            stopReason: "error",
            errorMessage: "Provider rejected the request.",
            timestamp: 1,
        };
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream() {
                return {
                    async *[Symbol.asyncIterator]() {
                        yield { type: "start" as const, partial: errorMessage };
                        started.resolve();
                        await release.promise;
                        yield {
                            type: "error" as const,
                            reason: "error" as const,
                            error: errorMessage,
                        };
                    },
                    async result() {
                        await release.promise;
                        return errorMessage;
                    },
                };
            },
        });
        const harness = createJustBashToolHarness();
        const agent = new Agent({
            provider,
            modelId: model.id,
            context: harness.context,
            printToConsole: false,
        });

        const run = agent.send("initial request");
        await started.promise;
        await agent.steer("pending error direction");
        release.resolve();

        await expect(run).resolves.toMatchObject({ stopReason: "error" });
        expect(agent.messages.at(-1)).toMatchObject({
            role: "user",
            blocks: [{ type: "text", text: "pending error direction" }],
        });
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

function usageWithTotalTokens(totalTokens: number): Usage {
    return {
        ...zeroUsage(),
        input: totalTokens,
        totalTokens,
    };
}
