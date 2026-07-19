import { zstdDecompressSync } from "node:zlib";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { validJpeg32Base64, validPng32Base64 } from "../tools/testing/validImageFixtures.js";
import { createCodexProvider } from "./codex.js";
import { CODEX_ULTRA_INSTRUCTIONS } from "./codexUltraInstructions.js";
import { modelOpenaiGpt55, modelOpenaiGpt56Sol } from "./models.js";
import type { Context } from "./types.js";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("codex provider", () => {
    it("generates images through the Codex backend with the upstream request shape", async () => {
        let requestUrl = "";
        let requestBody: unknown;
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
                requestUrl = String(input);
                requestBody = parseRequestBody(init);
                return Response.json({
                    data: [{ b64_json: validPng32Base64, revised_prompt: "A precise diagram" }],
                });
            }),
        );
        const provider = createCodexProvider({ apiKey: "codex-token" });

        await expect(provider.generateImage?.("Draw a diagram")).resolves.toEqual({
            data: validPng32Base64,
            mediaType: "image/png",
            revisedPrompt: "A precise diagram",
        });
        expect(requestUrl).toBe("https://chatgpt.com/backend-api/codex/images/generations");
        expect(requestBody).toEqual({
            background: "auto",
            model: "gpt-image-2",
            prompt: "Draw a diagram",
            quality: "auto",
            size: "auto",
        });
    });

    it("reports image API failures and empty output without fabricating an image", async () => {
        const provider = createCodexProvider({ apiKey: "codex-token" });
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof fetch>().mockResolvedValue(new Response("denied", { status: 403 })),
        );
        await expect(provider.generateImage?.("Draw it")).rejects.toThrow(
            "Codex image generation failed (403): denied",
        );

        vi.stubGlobal(
            "fetch",
            vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [] })),
        );
        await expect(provider.generateImage?.("Draw it")).rejects.toThrow(
            "Codex image generation returned no image data",
        );
    });

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

    it.each([
        { thinking: "max", expectedEffort: "max", hasUltraInstructions: false },
        { thinking: "ultra", expectedEffort: "max", hasUltraInstructions: true },
    ])(
        "maps GPT-5.6 $thinking reasoning to Codex $expectedEffort",
        async ({ thinking, expectedEffort, hasUltraInstructions }) => {
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
            if (hasUltraInstructions) {
                expect(instructions).toContain(CODEX_ULTRA_INSTRUCTIONS);
            } else {
                expect(instructions).not.toContain(CODEX_ULTRA_INSTRUCTIONS);
            }
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
