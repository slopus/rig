import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";

import type {
    KimiChatClient,
    KimiChatCompletionChunk,
    KimiChatRequest,
} from "./kimi-chat-types.js";
import { createKimiOpenAIClient } from "./createKimiOpenAIClient.js";
import { createKimiProvider } from "./kimi.js";
import { modelMoonshotKimiK3 } from "./models.js";

describe("Kimi provider", () => {
    it("exposes managed plan quota through the provider quota hook", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            Response.json({
                usage: { limit: 100, used: 14, reset_at: "2025-01-08T00:00:00Z" },
                limits: [
                    {
                        detail: { limit: 50, used: 4, reset_in: 12_000 },
                        window: { duration: 5, timeUnit: "HOUR" },
                    },
                ],
            }),
        );
        vi.stubGlobal("fetch", fetchMock);
        try {
            const provider = createKimiProvider({
                env: { KIMI_CODE_HOME: "/tmp/kimi-test" },
                resolveCredential: async () => ({ source: "session", token: "secret-token" }),
            });

            const quota = await provider.quota?.();

            expect(quota?.source).toBe("kimi");
            expect(quota?.windows.weekly).toMatchObject({
                status: "available",
                usedPercent: 14,
            });
            expect(quota?.windows.fiveHour).toMatchObject({
                status: "available",
                usedPercent: 8,
            });
            expect(fetchMock).toHaveBeenCalledOnce();
            expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.kimi.com/coding/v1/usages");
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("disables SDK request retries so the shared agent loop owns retry policy", () => {
        const client = createKimiOpenAIClient({
            baseUrl: "https://api.kimi.com/coding/v1",
            headers: {},
            token: "kimi-token",
        });

        expect((client as unknown as { maxRetries: number }).maxRetries).toBe(0);
    });

    it("reuses one Kimi client for sequential inference calls from the same agent", async () => {
        const clientFactory = vi.fn(
            (): KimiChatClient => ({
                chat: {
                    completions: {
                        async create() {
                            return chunks([{ choices: [{ delta: { content: "ok" } }] }]);
                        },
                    },
                },
            }),
        );
        const provider = createKimiProvider({
            clientFactory,
            env: { KIMI_CODE_HOME: "/tmp/kimi-test" },
            resolveCredential: async () => ({ source: "session", token: "secret-token" }),
        });

        await provider.stream(modelMoonshotKimiK3, { messages: [] }).result();
        await provider.stream(modelMoonshotKimiK3, { messages: [] }).result();

        expect(clientFactory).toHaveBeenCalledOnce();
    });

    it("sends the native K3 request and streams reasoning, text, parallel tools, and usage", async () => {
        let captured: KimiChatRequest | undefined;
        const clientFactory = vi.fn(
            (): KimiChatClient => ({
                chat: {
                    completions: {
                        async create(request) {
                            captured = request;
                            return chunks([
                                {
                                    id: "chat-1",
                                    model: "k3-concrete",
                                    choices: [{ delta: { reasoning_content: "Inspecting." } }],
                                },
                                {
                                    choices: [
                                        {
                                            delta: {
                                                tool_calls: [
                                                    {
                                                        function: {
                                                            arguments: '{"file_path":"/tmp/a',
                                                            name: "Read",
                                                        },
                                                        id: "call-a",
                                                        index: 0,
                                                    },
                                                    {
                                                        function: {
                                                            arguments: '{"pattern":"x"}',
                                                            name: "Grep",
                                                        },
                                                        id: "call-b",
                                                        index: 1,
                                                    },
                                                ],
                                            },
                                        },
                                    ],
                                },
                                {
                                    choices: [
                                        {
                                            delta: {
                                                content: "Working.",
                                                tool_calls: [
                                                    {
                                                        function: { arguments: '.txt"}' },
                                                        index: 0,
                                                    },
                                                ],
                                            },
                                        },
                                    ],
                                },
                                {
                                    choices: [{ delta: {}, finish_reason: "tool_calls" }],
                                    usage: {
                                        completion_tokens: 9,
                                        completion_tokens_details: { reasoning_tokens: 4 },
                                        prompt_tokens: 21,
                                        prompt_tokens_details: { cached_tokens: 5 },
                                        total_tokens: 30,
                                    },
                                },
                            ]);
                        },
                    },
                },
            }),
        );
        const provider = createKimiProvider({
            clientFactory,
            env: { KIMI_CODE_HOME: "/tmp/kimi-test" },
            resolveCredential: async () => ({ source: "session", token: "secret-token" }),
            sessionId: "session-k3",
        });
        const longId = `call|${"x".repeat(80)}`;
        const stream = provider.stream(
            modelMoonshotKimiK3,
            {
                systemPrompt: "Kimi test prompt",
                messages: [
                    { content: "Inspect the file.", role: "user", timestamp: 1 },
                    {
                        api: "rig",
                        content: [
                            { thinking: "Kimi reasoning.", type: "thinking" },
                            {
                                encrypted: "opaque-other-provider",
                                thinking: "Other reasoning.",
                                type: "thinking",
                            },
                            {
                                arguments: { file_path: "/tmp/a.txt" },
                                id: longId,
                                name: "Read",
                                type: "toolCall",
                            },
                        ],
                        model: modelMoonshotKimiK3.id,
                        provider: "kimi",
                        role: "assistant",
                        stopReason: "toolUse",
                        timestamp: 2,
                        usage: zeroUsage(),
                    },
                    {
                        content: [{ text: "contents", type: "text" }],
                        isError: false,
                        role: "toolResult",
                        timestamp: 3,
                        toolCallId: longId,
                        toolName: "Read",
                    },
                ],
                tools: [
                    {
                        description: "Read a file",
                        name: "Read",
                        parameters: Type.Unsafe({
                            properties: { mode: { enum: ["fast", "full"] } },
                            type: "object",
                        }),
                    },
                ],
            },
            { thinking: "max" },
        );
        for await (const _event of stream) {
            // Consume the real provider event stream.
        }
        const result = await stream.result();

        expect(clientFactory).toHaveBeenCalledWith(
            expect.objectContaining({ token: "secret-token" }),
        );
        expect(captured).toMatchObject({
            model: "k3",
            prompt_cache_key: "session-k3",
            stream: true,
            stream_options: { include_usage: true },
            thinking: { effort: "max", keep: "all", type: "enabled" },
        });
        expect(captured?.max_completion_tokens).toBe(131_072);
        const assistant = captured?.messages.find((message) => message.role === "assistant");
        const toolResult = captured?.messages.find((message) => message.role === "tool");
        expect(assistant?.reasoning_content).toBe("Kimi reasoning.");
        expect(assistant?.content).toBeUndefined();
        expect(assistant?.tool_calls?.[0]?.id).toHaveLength(64);
        expect(toolResult?.tool_call_id).toBe(assistant?.tool_calls?.[0]?.id);
        expect(captured?.tools?.[0]?.function.parameters).toMatchObject({
            properties: { mode: { enum: ["fast", "full"], type: "string" } },
        });
        expect(result.stopReason).toBe("toolUse");
        expect(result.responseId).toBe("chat-1");
        expect(result.responseModel).toBe("k3-concrete");
        expect(result.content).toEqual([
            { thinking: "Inspecting.", type: "thinking" },
            {
                arguments: { file_path: "/tmp/a.txt" },
                id: "call-a",
                name: "Read",
                type: "toolCall",
            },
            { arguments: { pattern: "x" }, id: "call-b", name: "Grep", type: "toolCall" },
            { text: "Working.", type: "text" },
        ]);
        expect(result.usage).toMatchObject({
            cacheRead: 5,
            input: 16,
            output: 9,
            reasoning: 4,
            totalTokens: 30,
        });
    });

    it("skips empty reasoning and content deltas from boundary chunks", async () => {
        const events: string[] = [];
        const provider = createKimiProvider({
            clientFactory: (): KimiChatClient => ({
                chat: {
                    completions: {
                        async create() {
                            return chunks([
                                { choices: [{ delta: { content: "", reasoning_content: "" } }] },
                                { choices: [{ delta: { reasoning_content: "Thinking." } }] },
                                {
                                    choices: [
                                        {
                                            delta: {
                                                tool_calls: [
                                                    {
                                                        function: { arguments: "{}", name: "Read" },
                                                        id: "call-1",
                                                        index: 0,
                                                    },
                                                ],
                                            },
                                        },
                                    ],
                                },
                                { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
                            ]);
                        },
                    },
                },
            }),
            env: { KIMI_CODE_HOME: "/tmp/kimi-test" },
            resolveCredential: async () => ({ source: "session", token: "secret-token" }),
        });
        const stream = provider.stream(modelMoonshotKimiK3, { messages: [] });
        for await (const event of stream) {
            events.push(event.type);
        }
        const result = await stream.result();
        expect(result.content).toEqual([
            { thinking: "Thinking.", type: "thinking" },
            { arguments: {}, id: "call-1", name: "Read", type: "toolCall" },
        ]);
        expect(events).not.toContain("text_start");
        expect(events).not.toContain("text_end");
    });

    it("ignores tool-call boundary chunks that carry no function name", async () => {
        const events: string[] = [];
        const provider = createKimiProvider({
            clientFactory: (): KimiChatClient => ({
                chat: {
                    completions: {
                        async create() {
                            return chunks([
                                { choices: [{ delta: { tool_calls: [{ index: 0 }] } }] },
                                {
                                    choices: [
                                        {
                                            delta: {
                                                tool_calls: [
                                                    {
                                                        function: { arguments: "", name: "Read" },
                                                        id: "call-1",
                                                        index: 0,
                                                    },
                                                ],
                                            },
                                        },
                                    ],
                                },
                                {
                                    choices: [
                                        {
                                            delta: {
                                                tool_calls: [
                                                    { function: { arguments: "{}" }, index: 0 },
                                                ],
                                            },
                                        },
                                    ],
                                },
                                { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
                            ]);
                        },
                    },
                },
            }),
            env: { KIMI_CODE_HOME: "/tmp/kimi-test" },
            resolveCredential: async () => ({ source: "session", token: "secret-token" }),
        });
        const stream = provider.stream(modelMoonshotKimiK3, { messages: [] });
        for await (const event of stream) {
            events.push(event.type);
        }
        const result = await stream.result();
        expect(result.stopReason).toBe("toolUse");
        expect(result.content).toEqual([
            { arguments: {}, id: "call-1", name: "Read", type: "toolCall" },
        ]);
        expect(events.filter((type) => type === "toolcall_start")).toHaveLength(1);
    });

    it("omits assistant content when a message has no text or tool calls", async () => {
        let captured: KimiChatRequest | undefined;
        const provider = createKimiProvider({
            clientFactory: (): KimiChatClient => ({
                chat: {
                    completions: {
                        async create(request) {
                            captured = request;
                            return chunks([{ choices: [{ delta: { content: "Done." } }] }]);
                        },
                    },
                },
            }),
            env: { KIMI_CODE_HOME: "/tmp/kimi-test" },
            resolveCredential: async () => ({ source: "session", token: "secret-token" }),
        });
        const stream = provider.stream(modelMoonshotKimiK3, {
            messages: [
                { content: "Hi", role: "user", timestamp: 1 },
                {
                    api: "rig",
                    content: [
                        { text: "", type: "text" },
                        { thinking: "Reasoned quietly.", type: "thinking" },
                    ],
                    model: modelMoonshotKimiK3.id,
                    provider: "kimi",
                    role: "assistant",
                    stopReason: "stop",
                    timestamp: 2,
                    usage: zeroUsage(),
                },
                { content: "Continue", role: "user", timestamp: 3 },
            ],
        });
        for await (const _event of stream) {
            // Consume the stream.
        }
        await stream.result();
        const assistant = captured?.messages.find((message) => message.role === "assistant");
        expect(assistant).toEqual({
            reasoning_content: "Reasoned quietly.",
            role: "assistant",
        });
    });

    it("keeps the completion budget at the ceiling when images fill the context", async () => {
        let captured: KimiChatRequest | undefined;
        const provider = createKimiProvider({
            clientFactory: (): KimiChatClient => ({
                chat: {
                    completions: {
                        async create(request) {
                            captured = request;
                            return chunks([{ choices: [{ delta: { content: "Done." } }] }]);
                        },
                    },
                },
            }),
            env: { KIMI_CODE_HOME: "/tmp/kimi-test" },
            resolveCredential: async () => ({ source: "session", token: "secret-token" }),
        });
        const image = {
            data: "A".repeat(4 * 1024 * 1024),
            mimeType: "image/png",
            type: "image" as const,
        };
        const stream = provider.stream(modelMoonshotKimiK3, {
            messages: [
                {
                    content: [image, { text: "What is this?", type: "text" }],
                    role: "user",
                    timestamp: 1,
                },
                { content: [image], role: "user", timestamp: 2 },
            ],
        });
        for await (const _event of stream) {
            // Consume the stream.
        }
        await stream.result();
        expect(captured?.max_completion_tokens).toBe(131_072);
    });

    it("surfaces an unknown finish reason as an incomplete response", async () => {
        const provider = createKimiProvider({
            clientFactory: (): KimiChatClient => ({
                chat: {
                    completions: {
                        async create() {
                            return chunks([
                                { choices: [{ delta: { content: "Partial" } }] },
                                { choices: [{ delta: {}, finish_reason: "content_filter" }] },
                            ]);
                        },
                    },
                },
            }),
            env: { KIMI_CODE_HOME: "/tmp/kimi-test" },
            resolveCredential: async () => ({ source: "session", token: "secret-token" }),
        });
        const stream = provider.stream(modelMoonshotKimiK3, { messages: [] });
        for await (const _event of stream) {
            // Consume the stream.
        }
        const result = await stream.result();
        expect(result.stopReason).toBe("error");
        expect(result.errorCode).toBe("incomplete_response");
        expect(result.errorMessage).toContain("content_filter");
    });

    it("forces one credential refresh after a pre-stream 403", async () => {
        const tokens: string[] = [];
        const provider = createKimiProvider({
            clientFactory: ({ token }) => ({
                chat: {
                    completions: {
                        async create() {
                            tokens.push(token);
                            if (token === "stale") throw { status: 403 };
                            return chunks([{ choices: [{ delta: { content: "Recovered" } }] }]);
                        },
                    },
                },
            }),
            env: { KIMI_CODE_HOME: "/tmp/kimi-test" },
            resolveCredential: async ({ force } = {}) => ({
                source: "session",
                token: force === true ? "fresh" : "stale",
            }),
        });
        const stream = provider.stream(modelMoonshotKimiK3, { messages: [] });
        for await (const _event of stream) {
            // Consume the stream.
        }
        expect((await stream.result()).content).toEqual([{ text: "Recovered", type: "text" }]);
        expect(tokens).toEqual(["stale", "fresh"]);
    });

    it("forces one credential refresh after a pre-stream 401", async () => {
        const forceValues: boolean[] = [];
        const tokens: string[] = [];
        const provider = createKimiProvider({
            clientFactory: ({ token }) => ({
                chat: {
                    completions: {
                        async create() {
                            tokens.push(token);
                            if (token === "stale") throw { status: 401 };
                            return chunks([{ choices: [{ delta: { content: "Recovered" } }] }]);
                        },
                    },
                },
            }),
            env: { KIMI_CODE_HOME: "/tmp/kimi-test" },
            resolveCredential: async ({ force } = {}) => {
                forceValues.push(force === true);
                return { source: "session", token: force === true ? "fresh" : "stale" };
            },
        });
        const stream = provider.stream(modelMoonshotKimiK3, { messages: [] });
        for await (const _event of stream) {
            // Consume the stream.
        }
        expect((await stream.result()).content).toEqual([{ text: "Recovered", type: "text" }]);
        expect(forceValues).toEqual([false, true]);
        expect(tokens).toEqual(["stale", "fresh"]);
    });
});

function chunks(
    values: readonly KimiChatCompletionChunk[],
): AsyncIterable<KimiChatCompletionChunk> {
    return {
        async *[Symbol.asyncIterator]() {
            yield* values;
        },
    };
}

function zeroUsage() {
    return {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
    };
}
