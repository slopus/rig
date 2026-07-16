import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Type } from "@sinclair/typebox";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createGrokOpenAIRequest } from "./createGrokOpenAIRequest.js";
import { createGrokOpenAIClient, type GrokOpenAIClient } from "./createGrokOpenAIClient.js";
import { createGrokRequestHeaders } from "./createGrokRequestHeaders.js";
import { GROK_OAUTH_CLIENT_ID, GROK_OAUTH_ISSUER, GROK_OAUTH_SCOPE } from "./grok-auth-types.js";
import { createGrokProvider, GROK_API_MODEL_ID, GROK_DEFAULT_BASE_URL } from "./grok.js";
import { modelXaiGrok45, modelXaiGrokBuild, modelXaiGrokComposer25Fast } from "./models.js";
import { resolveGrokCredential } from "./resolveGrokCredential.js";
import { writeGrokAuthRecord } from "./writeGrokAuthRecord.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

describe("Grok Build provider", () => {
    it("advertises the curated Grok models and endpoint", () => {
        const provider = createGrokProvider();

        expect(provider.id).toBe("grok");
        expect(provider.models).toEqual([
            modelXaiGrokBuild,
            modelXaiGrok45,
            modelXaiGrokComposer25Fast,
        ]);
        expect(modelXaiGrokBuild).toMatchObject({
            contextWindow: 500_000,
            defaultThinkingLevel: "on",
            id: "xai/grok-build",
            name: "Grok Build",
            thinkingLevels: ["on"],
        });
        expect(GROK_DEFAULT_BASE_URL).toBe("https://cli-chat-proxy.grok.com/v1");
    });

    it("builds the same Responses API sampling request as Grok Build", () => {
        const request = createGrokOpenAIRequest({
            apiModelId: GROK_API_MODEL_ID,
            context: {
                messages: [{ role: "user", content: "Hello", timestamp: 1 }],
                systemPrompt: "You are Grok Build.",
                tools: [
                    {
                        name: "read_file",
                        description: "Read a file.",
                        parameters: Type.Object({ target_file: Type.String() }),
                    },
                ],
            },
            model: modelXaiGrokBuild,
        });

        expect(request).toMatchObject({
            include: ["reasoning.encrypted_content"],
            instructions: "You are Grok Build.",
            model: "grok-build",
            reasoning: { summary: "concise" },
            store: false,
            stream: true,
            temperature: 0.7,
            top_p: 0.95,
            tools: [
                {
                    type: "function",
                    name: "read_file",
                    description: "Read a file.",
                },
            ],
        });
    });

    it("uses the model catalog's selectable reasoning efforts", () => {
        expect(modelXaiGrok45).toEqual({
            contextWindow: 500_000,
            defaultThinkingLevel: "high",
            id: "xai/grok-4.5",
            name: "Grok 4.5",
            thinkingLevels: ["low", "medium", "high"],
        });
        expect(modelXaiGrokComposer25Fast).toEqual({
            contextWindow: 200_000,
            defaultThinkingLevel: "off",
            id: "xai/grok-composer-2.5-fast",
            name: "Composer 2.5",
            thinkingLevels: ["off"],
        });
        expect(
            createGrokOpenAIRequest({
                apiModelId: "grok-4.5",
                context: { messages: [{ role: "user", content: "Hello", timestamp: 1 }] },
                model: modelXaiGrok45,
                streamOptions: { thinking: "low" },
            }).reasoning,
        ).toEqual({ effort: "low", summary: "concise" });
        expect(
            createGrokOpenAIRequest({
                apiModelId: "grok-composer-2.5-fast",
                context: { messages: [{ role: "user", content: "Hello", timestamp: 1 }] },
                model: modelXaiGrokComposer25Fast,
            }).reasoning,
        ).toEqual({ summary: "concise" });
    });

    it("sends Grok request identity headers", () => {
        const headers = createGrokRequestHeaders({
            baseUrl: GROK_DEFAULT_BASE_URL,
            model: "grok-build",
            sessionId: "session-123",
            turnIndex: 3,
        });

        expect(headers).toMatchObject({
            "x-grok-agent-id": "session-123",
            "x-grok-client-identifier": "grok-shell",
            "x-grok-client-version": "0.1.220-alpha.4",
            "x-grok-conv-id": "session-123",
            "x-grok-model-override": "grok-build",
            "x-grok-session-id": "session-123",
            "x-grok-turn-idx": "3",
            "x-authenticateresponse": "authenticate-response",
            "x-grok-client-mode": "interactive",
            "x-xai-token-auth": "xai-grok-cli",
        });
        expect(headers["x-grok-req-id"]).toBeTruthy();
    });

    it("does not send first-party proxy authentication headers to custom endpoints", () => {
        const headers = createGrokRequestHeaders({
            baseUrl: "https://example.com/v1",
            model: "grok-build",
        });

        expect(headers["x-xai-token-auth"]).toBeUndefined();
        expect(headers["x-authenticateresponse"]).toBeUndefined();
        expect(headers["x-grok-client-mode"]).toBeUndefined();
        expect(headers["x-grok-client-version"]).toBe("0.1.220-alpha.4");
    });

    it("does not automatically replay inference requests", () => {
        const client = createGrokOpenAIClient({
            baseUrl: GROK_DEFAULT_BASE_URL,
            headers: {},
            token: "session-token",
        });

        expect(client.maxRetries).toBe(0);
    });

    it("streams Responses API output without replaying the request", async () => {
        const response = {
            id: "response-1",
            model: "grok-build",
            status: "completed",
            usage: {
                input_tokens: 12,
                input_tokens_details: { cached_tokens: 2, cache_write_tokens: 0 },
                output_tokens: 3,
                output_tokens_details: { reasoning_tokens: 0 },
                total_tokens: 15,
            },
        } as unknown as OpenAIResponse;
        const responseStream = {
            async *[Symbol.asyncIterator]() {
                yield {
                    type: "response.output_item.added" as const,
                    output_index: 0,
                    item: {
                        type: "message" as const,
                        id: "message-1",
                        role: "assistant" as const,
                        status: "in_progress" as const,
                        content: [],
                    },
                };
                yield {
                    type: "response.output_text.delta" as const,
                    output_index: 0,
                    delta: "Hello from Grok",
                };
                yield {
                    type: "response.output_item.done" as const,
                    output_index: 0,
                    item: {
                        type: "message" as const,
                        id: "message-1",
                        role: "assistant" as const,
                        status: "completed" as const,
                        content: [
                            {
                                type: "output_text" as const,
                                text: "Hello from Grok",
                                annotations: [],
                            },
                        ],
                    },
                };
                yield { type: "response.completed" as const, response };
            },
        };
        const create = vi.fn((..._args: unknown[]) => responseStream);
        const provider = createGrokProvider({
            client: { responses: { create } } as unknown as GrokOpenAIClient,
            resolveCredential: async () => ({ source: "session", token: "session-token" }),
        });

        const message = await provider
            .stream(modelXaiGrokBuild, {
                messages: [{ role: "user", content: "Hello", timestamp: 1 }],
            })
            .result();

        expect(create).toHaveBeenCalledOnce();
        expect(create.mock.calls[0]?.[0]).toMatchObject({ model: "grok-build", stream: true });
        expect(message).toMatchObject({
            api: "openai-responses",
            content: [{ type: "text", text: "Hello from Grok" }],
            model: "xai/grok-build",
            provider: "grok",
            stopReason: "stop",
            usage: { cacheRead: 2, input: 10, output: 3, totalTokens: 15 },
        });
    });

    it("preserves an incomplete response reason as a retryable stream error", async () => {
        const response = {
            id: "response-incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            model: "grok-build",
            status: "incomplete",
        } as unknown as OpenAIResponse;
        const responseStream = {
            async *[Symbol.asyncIterator]() {
                yield { type: "response.incomplete" as const, response };
            },
        };
        const provider = createGrokProvider({
            client: {
                responses: { create: vi.fn(() => responseStream) },
            } as unknown as GrokOpenAIClient,
            resolveCredential: async () => ({ source: "session", token: "session-token" }),
        });

        const message = await provider.stream(modelXaiGrokBuild, { messages: [] }).result();

        expect(message).toMatchObject({
            errorCode: "incomplete_response",
            errorMessage: "Incomplete response returned, reason: max_output_tokens",
            stopReason: "error",
        });
    });

    it("attributes fallback failures to the selected Grok model", async () => {
        const response = {
            error: null,
            incomplete_details: null,
            model: "grok-composer-2.5-fast",
            status: "failed",
        } as unknown as OpenAIResponse;
        const responseStream = {
            async *[Symbol.asyncIterator]() {
                yield { type: "response.failed" as const, response };
            },
        };
        const provider = createGrokProvider({
            client: {
                responses: { create: vi.fn(() => responseStream) },
            } as unknown as GrokOpenAIClient,
            resolveCredential: async () => ({ source: "session", token: "session-token" }),
        });

        const message = await provider
            .stream(modelXaiGrokComposer25Fast, { messages: [] })
            .result();

        expect(message).toMatchObject({
            errorMessage: "Composer 2.5 failed to generate a response.",
            model: modelXaiGrokComposer25Fast.id,
            stopReason: "error",
        });
    });
});

describe("Grok Build authentication", () => {
    it("prefers a hot-reloaded session over XAI_API_KEY", async () => {
        const { authFile } = await createAuthHome({
            [GROK_OAUTH_SCOPE]: {
                auth_mode: "oidc",
                create_time: new Date().toISOString(),
                key: "first-session-token",
            },
        });

        expect(
            await resolveGrokCredential({ authFile, env: { XAI_API_KEY: "environment-key" } }),
        ).toEqual({ source: "session", token: "first-session-token" });

        await writeFile(
            authFile,
            JSON.stringify({
                [GROK_OAUTH_SCOPE]: {
                    auth_mode: "oidc",
                    create_time: new Date().toISOString(),
                    key: "second-session-token",
                },
            }),
        );
        expect(await resolveGrokCredential({ authFile, env: {} })).toEqual({
            source: "session",
            token: "second-session-token",
        });
    });

    it("refreshes an expiring OIDC token and persists the rotated credentials", async () => {
        const now = Date.parse("2026-07-15T12:00:00.000Z");
        const { authFile } = await createAuthHome({
            [GROK_OAUTH_SCOPE]: {
                auth_mode: "oidc",
                create_time: "2026-07-15T11:00:00.000Z",
                expires_at: "2026-07-15T12:01:00.000Z",
                key: "expiring-token",
                oidc_client_id: GROK_OAUTH_CLIENT_ID,
                oidc_issuer: GROK_OAUTH_ISSUER,
                refresh_token: "old-refresh-token",
            },
        });
        const request = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
            const url = String(input);
            if (url.endsWith("/.well-known/openid-configuration")) {
                return new Response(JSON.stringify({ token_endpoint: "https://auth.x.ai/token" }));
            }
            expect(url).toBe("https://auth.x.ai/token");
            expect(String(init?.body)).toContain("refresh_token=old-refresh-token");
            return new Response(
                JSON.stringify({
                    access_token: "refreshed-token",
                    expires_in: 3600,
                    refresh_token: "rotated-refresh-token",
                }),
            );
        });

        expect(
            await resolveGrokCredential({ authFile, env: {}, fetch: request, now: () => now }),
        ).toEqual({ source: "session", token: "refreshed-token" });
        expect(request).toHaveBeenCalledTimes(2);
        expect(JSON.parse(await readFile(authFile, "utf8"))).toMatchObject({
            [GROK_OAUTH_SCOPE]: {
                create_time: "2026-07-15T12:00:00.000Z",
                expires_at: "2026-07-15T13:00:00.000Z",
                key: "refreshed-token",
                refresh_token: "rotated-refresh-token",
            },
        });
    });

    it("uses explicit API keys and gives an actionable sign-in error", async () => {
        expect(await resolveGrokCredential({ apiKey: "explicit-key", env: {} })).toEqual({
            source: "api-key",
            token: "explicit-key",
        });
        await expect(
            resolveGrokCredential({ authFile: "/missing/grok/auth.json", env: {} }),
        ).rejects.toThrow("Run `grok login` or set XAI_API_KEY");
    });

    it("ignores authentication records outside the current Grok scopes", async () => {
        const { authFile } = await createAuthHome({
            "https://accounts.example.test/sign-in": {
                auth_mode: "oidc",
                key: "unknown-scope-token",
            },
        });

        await expect(
            resolveGrokCredential({ authFile, env: { XAI_API_KEY: "environment-key" } }),
        ).resolves.toEqual({ source: "api-key", token: "environment-key" });
    });

    it("does not resurrect credentials removed during a refresh", async () => {
        const { authFile } = await createAuthHome({});

        await expect(
            writeGrokAuthRecord({
                path: authFile,
                scope: GROK_OAUTH_SCOPE,
                expectedKey: "removed-token",
                record: { key: "refreshed-token" },
            }),
        ).rejects.toThrow("authentication changed");
        expect(JSON.parse(await readFile(authFile, "utf8"))).toEqual({});
    });
});

async function createAuthHome(store: Record<string, unknown>): Promise<{ authFile: string }> {
    const root = await mkdtemp(join(tmpdir(), "rig-grok-auth-"));
    temporaryDirectories.push(root);
    const authFile = join(root, "auth.json");
    await mkdir(root, { recursive: true });
    await writeFile(authFile, JSON.stringify(store), { mode: 0o600 });
    return { authFile };
}
