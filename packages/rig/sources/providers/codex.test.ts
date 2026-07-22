import { zstdDecompressSync } from "node:zlib";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
import { WebSocketServer } from "ws";

import { validJpeg32Base64, validPng32Base64 } from "../tools/testing/validImageFixtures.js";
import { createCodexProvider } from "./codex.js";
import { createCodexWebSocketResponseStream } from "./createCodexWebSocketResponseStream.js";
import { modelOpenaiGpt55, modelOpenaiGpt56Sol } from "./models.js";
import type { Context } from "./types.js";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("codex provider", () => {
    it("loads local authentication from CODEX_HOME", async () => {
        const codexHome = await mkdtemp(join(tmpdir(), "rig-codex-home-"));
        const accessToken =
            "e30.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjb3VudC10ZXN0In19.x";
        try {
            await writeFile(
                join(codexHome, "auth.json"),
                JSON.stringify({ tokens: { access_token: accessToken } }),
            );
            let authorization: string | null = null;
            vi.stubGlobal(
                "fetch",
                vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
                    authorization = new Headers(init?.headers).get("authorization");
                    return new Response("data: [DONE]\n\n", {
                        status: 200,
                        headers: { "content-type": "text/event-stream" },
                    });
                }),
            );
            const provider = createCodexProvider({
                env: { CODEX_HOME: codexHome },
                transport: "sse",
            });

            for await (const _event of provider.stream(modelOpenaiGpt55, emptyContext())) {
                // Drain the stream so the provider sends the request.
            }

            expect(authorization).toBe(`Bearer ${accessToken}`);
        } finally {
            await rm(codexHome, { recursive: true });
        }
    });

    it("advertises fast inference and maps it to the Responses priority tier", async () => {
        let requestBody: unknown;
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
                requestBody = parseRequestBody(init);
                return new Response("data: [DONE]\n\n", {
                    status: 200,
                    headers: { "content-type": "text/event-stream" },
                });
            }),
        );

        const provider = createCodexProvider({
            apiKey: "e30.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjb3VudC10ZXN0In19.x",
            transport: "sse",
        });
        const stream = provider.stream(modelOpenaiGpt56Sol, emptyContext(), {
            serviceTier: "fast",
        });

        for await (const _event of stream) {
            // Draining the stream makes the provider build and send its request.
        }

        expect(provider.serviceTiers).toEqual(["fast"]);
        expect(requestBody).toMatchObject({
            model: "gpt-5.6-sol",
            service_tier: "priority",
        });
    });

    it.each([
        {
            expected: {
                requestId: "a22a6855-605a-4f23-9955-429f689b87c1",
                type: "internal_server_error",
            },
            message:
                "An error occurred while processing your request. Please include the request ID a22a6855-605a-4f23-9955-429f689b87c1 in your message.",
            name: "internal server",
        },
        {
            expected: { type: "server_overloaded" },
            message: "Our servers are currently overloaded. Please try again later.",
            name: "server overload",
        },
    ])("classifies a Codex $name stream failure", async ({ expected, message }) => {
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof fetch>().mockResolvedValue(
                new Response(`data: ${JSON.stringify({ error: { message }, type: "error" })}\n\n`, {
                    status: 200,
                    headers: { "content-type": "text/event-stream" },
                }),
            ),
        );
        const provider = createCodexProvider({
            apiKey: "e30.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjb3VudC10ZXN0In19.x",
            transport: "sse",
        });

        const result = await provider.stream(modelOpenaiGpt55, emptyContext()).result();

        expect(result).toMatchObject({ providerError: expected, stopReason: "error" });
    });

    it.each([
        { name: "PNG", mediaType: "image/png", base64: validPng32Base64 },
        { name: "JPEG", mediaType: "image/jpeg", base64: validJpeg32Base64 },
    ])(
        "serializes an exact $name tool result into the Responses API request",
        async ({ mediaType, base64 }) => {
            let requestBody: unknown;
            vi.stubGlobal(
                "fetch",
                vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
                    requestBody = parseRequestBody(init);
                    return new Response("data: [DONE]\n\n", {
                        status: 200,
                        headers: { "content-type": "text/event-stream" },
                    });
                }),
            );

            const provider = createCodexProvider({
                apiKey: "e30.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjb3VudC10ZXN0In19.x",
                transport: "sse",
            });
            const stream = provider.stream(
                modelOpenaiGpt55,
                imageToolResultContext(mediaType, base64),
            );

            for await (const _event of stream) {
                // Draining the stream makes the provider build and send its request.
            }

            expect(requestBody).toMatchObject({
                model: "gpt-5.5",
                input: expect.arrayContaining([
                    {
                        type: "function_call_output",
                        call_id: "call_image",
                        output: [
                            {
                                type: "input_image",
                                detail: "original",
                                image_url: `data:${mediaType};base64,${base64}`,
                            },
                        ],
                    },
                ]),
            });
        },
    );

    it("sends Code Mode exec as an OpenAI custom tool with raw-input grammar", async () => {
        let requestBody: unknown;
        let requestUrl = "";
        let headers = new Headers();
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
                requestUrl = String(input);
                requestBody = parseRequestBody(init);
                headers = new Headers(init?.headers);
                return new Response("data: [DONE]\n\n", {
                    status: 200,
                    headers: { "content-type": "text/event-stream" },
                });
            }),
        );
        const accessToken =
            "e30.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjb3VudC10ZXN0In19.x";
        const provider = createCodexProvider({ apiKey: accessToken, transport: "sse" });
        const context: Context = {
            ...emptyContext(),
            tools: [
                {
                    kind: "custom",
                    name: "exec",
                    description: "Run JavaScript.",
                    format: {
                        type: "grammar",
                        syntax: "lark",
                        definition: "start: SOURCE\nSOURCE: /[\\s\\S]+/",
                    },
                },
            ],
        };

        for await (const _event of provider.stream(modelOpenaiGpt56Sol, context)) {
            // Drain the stream so the request is sent.
        }

        expect(requestUrl).toContain("/backend-api/codex/responses");
        expect(headers.get("chatgpt-account-id")).toBe("account-test");
        expect(headers.get("originator")).toBe("codex_cli_rs");
        expect(requestBody).toMatchObject({
            model: "gpt-5.6-sol",
            parallel_tool_calls: false,
            tools: [
                {
                    type: "custom",
                    name: "exec",
                    format: {
                        type: "grammar",
                        syntax: "lark",
                        definition: "start: SOURCE\nSOURCE: /[\\s\\S]+/",
                    },
                },
            ],
        });
    });

    it("sends Code Mode custom tools over the Codex WebSocket transport by default", async () => {
        const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
        await once(server, "listening");
        const address = server.address();
        if (typeof address === "string" || address === null) {
            throw new Error("Expected a TCP WebSocket test server.");
        }

        let requestFrame: unknown;
        let requestHeaders: NodeJS.Dict<string | string[]> = {};
        server.on("connection", (socket, request) => {
            requestHeaders = request.headers;
            socket.once("message", (data) => {
                requestFrame = JSON.parse(data.toString());
                socket.send(
                    JSON.stringify({
                        type: "response.completed",
                        response: {
                            id: "response-code-mode",
                            model: "gpt-5.6-sol",
                            status: "completed",
                            usage: {
                                input_tokens: 1,
                                input_tokens_details: { cached_tokens: 0 },
                                output_tokens: 1,
                                total_tokens: 2,
                            },
                        },
                    }),
                );
            });
        });
        const provider = createCodexProvider({
            apiKey: "e30.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjb3VudC10ZXN0In19.x",
            baseUrl: `http://127.0.0.1:${address.port}/backend-api`,
        });

        try {
            const context: Context = {
                ...emptyContext(),
                tools: [{ kind: "custom", name: "exec", description: "Run JavaScript." }],
            };

            await expect(
                provider.stream(modelOpenaiGpt56Sol, context).result(),
            ).resolves.toMatchObject({ stopReason: "stop" });

            expect(requestHeaders["openai-beta"]).toBe("responses_websockets=2026-02-06");
            expect(requestFrame).toMatchObject({
                type: "response.create",
                model: "gpt-5.6-sol",
                parallel_tool_calls: false,
                tools: [{ type: "custom", name: "exec" }],
            });
        } finally {
            await provider.close?.();
            server.close();
            await once(server, "close");
        }
    });

    it("keeps one Codex WebSocket open across sequential agent inference calls", async () => {
        const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
        await once(server, "listening");
        const address = server.address();
        if (typeof address === "string" || address === null) {
            throw new Error("Expected a TCP WebSocket test server.");
        }

        let connections = 0;
        let requests = 0;
        const requestFrames: Record<string, unknown>[] = [];
        server.on("connection", (socket) => {
            connections += 1;
            socket.on("message", (data) => {
                requests += 1;
                requestFrames.push(JSON.parse(data.toString()) as Record<string, unknown>);
                if (requests === 1) {
                    const item = {
                        type: "custom_tool_call",
                        id: "custom-1",
                        call_id: "call-1",
                        name: "exec",
                        input: 'text("done")',
                    };
                    socket.send(
                        JSON.stringify({
                            type: "response.output_item.added",
                            output_index: 0,
                            item: { ...item, input: "" },
                        }),
                    );
                    socket.send(
                        JSON.stringify({
                            type: "response.custom_tool_call_input.done",
                            output_index: 0,
                            item_id: item.id,
                            input: item.input,
                        }),
                    );
                    socket.send(
                        JSON.stringify({
                            type: "response.output_item.done",
                            output_index: 0,
                            item,
                        }),
                    );
                }
                socket.send(
                    JSON.stringify({
                        type: "response.completed",
                        response: {
                            id: `response-${requests}`,
                            model: "gpt-5.6-sol",
                            status: "completed",
                            usage: {
                                input_tokens: 1,
                                input_tokens_details: { cached_tokens: 0 },
                                output_tokens: 1,
                                total_tokens: 2,
                            },
                        },
                    }),
                );
            });
        });

        const provider = createCodexProvider({
            apiKey: "e30.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjb3VudC10ZXN0In19.x",
            baseUrl: `http://127.0.0.1:${address.port}/backend-api`,
        });
        const context: Context = {
            ...emptyContext(),
            tools: [{ kind: "custom", name: "exec", description: "Run JavaScript." }],
        };

        try {
            const firstResponse = await provider.stream(modelOpenaiGpt56Sol, context).result();
            expect(firstResponse).toMatchObject({ stopReason: "toolUse" });
            await provider
                .stream(modelOpenaiGpt56Sol, {
                    ...context,
                    messages: [
                        ...context.messages,
                        firstResponse,
                        {
                            role: "toolResult",
                            toolCallId: "call-1|custom-1",
                            toolName: "exec",
                            content: [{ type: "text", text: "done" }],
                            isError: false,
                            timestamp: Date.now(),
                        },
                    ],
                })
                .result();

            expect(requests).toBe(2);
            expect(connections).toBe(1);
            expect(requestFrames[1]).toMatchObject({
                input: [
                    {
                        type: "custom_tool_call_output",
                        call_id: "call-1",
                        output: "done",
                    },
                ],
                previous_response_id: "response-1",
                type: "response.create",
            });
        } finally {
            await provider.close?.();
            server.close();
            await once(server, "close");
        }
    });

    it("reconnects the agent-scoped Codex WebSocket after the server closes it", async () => {
        const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
        await once(server, "listening");
        const address = server.address();
        if (typeof address === "string" || address === null) {
            throw new Error("Expected a TCP WebSocket test server.");
        }

        let connections = 0;
        let requests = 0;
        let firstSocketClosed: Promise<unknown> | undefined;
        server.on("connection", (socket) => {
            connections += 1;
            socket.on("message", () => {
                requests += 1;
                socket.send(
                    JSON.stringify({
                        type: "response.completed",
                        response: {
                            id: `response-${requests}`,
                            model: "gpt-5.6-sol",
                            status: "completed",
                            usage: {
                                input_tokens: 1,
                                input_tokens_details: { cached_tokens: 0 },
                                output_tokens: 1,
                                total_tokens: 2,
                            },
                        },
                    }),
                );
                if (requests === 1) {
                    firstSocketClosed = once(socket, "close");
                    socket.close();
                }
            });
        });
        const provider = createCodexProvider({
            apiKey: "e30.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjb3VudC10ZXN0In19.x",
            baseUrl: `http://127.0.0.1:${address.port}/backend-api`,
        });
        const context: Context = {
            ...emptyContext(),
            tools: [{ kind: "custom", name: "exec", description: "Run JavaScript." }],
        };

        try {
            await provider.stream(modelOpenaiGpt56Sol, context).result();
            await firstSocketClosed;
            await provider.stream(modelOpenaiGpt56Sol, context).result();

            expect(requests).toBe(2);
            expect(connections).toBe(2);
        } finally {
            await provider.close?.();
            server.close();
            await once(server, "close");
        }
    });

    it("reconnects with full context after a terminal Codex response failure", async () => {
        const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
        await once(server, "listening");
        const address = server.address();
        if (typeof address === "string" || address === null) {
            throw new Error("Expected a TCP WebSocket test server.");
        }

        let connections = 0;
        const requestFrames: Record<string, unknown>[] = [];
        server.on("connection", (socket) => {
            connections += 1;
            socket.once("message", (data) => {
                requestFrames.push(JSON.parse(data.toString()) as Record<string, unknown>);
                if (connections === 1) {
                    socket.send(
                        JSON.stringify({
                            type: "response.failed",
                            response: {
                                id: "response-failed",
                                model: "gpt-5.6-sol",
                                status: "failed",
                                error: { code: "server_error", message: "synthetic failure" },
                            },
                        }),
                    );
                    return;
                }
                socket.send(
                    JSON.stringify({
                        type: "response.completed",
                        response: {
                            id: "response-recovered",
                            model: "gpt-5.6-sol",
                            status: "completed",
                            usage: {
                                input_tokens: 1,
                                input_tokens_details: { cached_tokens: 0 },
                                output_tokens: 1,
                                total_tokens: 2,
                            },
                        },
                    }),
                );
            });
        });
        const provider = createCodexProvider({
            apiKey: "e30.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjb3VudC10ZXN0In19.x",
            baseUrl: `http://127.0.0.1:${address.port}/backend-api`,
        });
        const context: Context = {
            ...emptyContext(),
            tools: [{ kind: "custom", name: "exec", description: "Run JavaScript." }],
        };

        try {
            await expect(
                provider.stream(modelOpenaiGpt56Sol, context).result(),
            ).resolves.toMatchObject({ stopReason: "error" });
            await expect(
                provider.stream(modelOpenaiGpt56Sol, context).result(),
            ).resolves.toMatchObject({ stopReason: "stop" });

            expect(connections).toBe(2);
            expect(requestFrames[1]).not.toHaveProperty("previous_response_id");
            expect(requestFrames[1]).toMatchObject({ input: requestFrames[0]?.input });
        } finally {
            await provider.close?.();
            server.close();
            await once(server, "close");
        }
    });

    it("times out an idle Codex WebSocket response", async () => {
        const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
        await once(server, "listening");
        const address = server.address();
        if (typeof address === "string" || address === null) {
            throw new Error("Expected a TCP WebSocket test server.");
        }

        try {
            const stream = createCodexWebSocketResponseStream({
                client: new OpenAI({
                    apiKey: "test-token",
                    baseURL: `http://127.0.0.1:${address.port}`,
                    maxRetries: 0,
                    timeout: 25,
                }),
                headers: {},
                request: { model: "gpt-5.6-sol" },
            });

            await expect(stream.next()).rejects.toThrow(
                "Codex WebSocket timed out after 25ms without receiving a response event.",
            );
        } finally {
            server.close();
            await once(server, "close");
        }
    });

    it("reports caller cancellation as an aborted Codex WebSocket response", async () => {
        const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
        await once(server, "listening");
        const address = server.address();
        if (typeof address === "string" || address === null) {
            throw new Error("Expected a TCP WebSocket test server.");
        }
        const controller = new AbortController();

        try {
            const stream = createCodexWebSocketResponseStream({
                client: new OpenAI({
                    apiKey: "test-token",
                    baseURL: `http://127.0.0.1:${address.port}`,
                    maxRetries: 0,
                }),
                headers: {},
                request: { model: "gpt-5.6-sol" },
                signal: controller.signal,
            });
            const next = stream.next();
            await once(server, "connection");
            controller.abort();

            await expect(next).rejects.toMatchObject({ name: "AbortError" });
        } finally {
            server.close();
            await once(server, "close");
        }
    });

    it.each([
        { thinking: "max", expectedEffort: "max" },
        { thinking: "ultra", expectedEffort: "max" },
    ])(
        "maps GPT-5.6 $thinking reasoning to Codex $expectedEffort",
        async ({ thinking, expectedEffort }) => {
            let requestBody: unknown;
            vi.stubGlobal(
                "fetch",
                vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
                    requestBody = parseRequestBody(init);
                    return new Response("data: [DONE]\n\n", {
                        status: 200,
                        headers: { "content-type": "text/event-stream" },
                    });
                }),
            );

            const provider = createCodexProvider({
                apiKey: "e30.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjb3VudC10ZXN0In19.x",
                transport: "sse",
            });
            const stream = provider.stream(modelOpenaiGpt56Sol, emptyContext(), {
                thinking,
            });

            for await (const _event of stream) {
                // Draining the stream makes the provider build and send its request.
            }

            expect(requestBody).toMatchObject({
                model: "gpt-5.6-sol",
                reasoning: {
                    effort: expectedEffort,
                },
            });
            const instructions = (requestBody as { instructions?: unknown }).instructions;
            expect(instructions).toBe("You are a helpful assistant.");
        },
    );
});

function parseRequestBody(init: RequestInit | undefined): unknown {
    if (typeof init?.body === "string") return JSON.parse(init.body);
    if (init?.body === undefined || init.body === null) return undefined;
    const body = Buffer.from(init.body as Uint8Array);
    const encoding = new Headers(init.headers).get("content-encoding");
    return JSON.parse((encoding === "zstd" ? zstdDecompressSync(body) : body).toString("utf8"));
}

function emptyContext(): Context {
    return {
        messages: [
            {
                role: "user",
                content: "Hello.",
                timestamp: Date.now(),
            },
        ],
    };
}

function imageToolResultContext(mediaType: string, base64: string): Context {
    const timestamp = Date.now();
    return {
        messages: [
            {
                role: "user",
                content: "Inspect the image.",
                timestamp,
            },
            {
                role: "assistant",
                content: [
                    {
                        type: "toolCall",
                        id: "call_image|fc_image",
                        name: "view_image",
                        arguments: { path: "/workspace/generated.png" },
                    },
                ],
                api: "rig",
                provider: "codex",
                model: modelOpenaiGpt55.id,
                usage: zeroUsage(),
                stopReason: "toolUse",
                timestamp,
            },
            {
                role: "toolResult",
                toolCallId: "call_image|fc_image",
                toolName: "view_image",
                content: [
                    {
                        type: "image",
                        mimeType: mediaType,
                        data: base64,
                        detail: "original",
                    },
                ],
                isError: false,
                timestamp,
            },
        ],
    };
}

function zeroUsage() {
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
