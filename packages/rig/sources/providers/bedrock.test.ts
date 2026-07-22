import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { BedrockOpenAI } from "openai";
import type { Response } from "openai/resources/responses/responses.js";
import { describe, expect, it, vi } from "vitest";

import { BEDROCK_MODEL_ROUTES } from "./bedrock-model-routes.js";
import {
    modelAnthropicOpus48,
    modelAnthropicSonnet5,
    modelOpenaiGpt56Luna,
    modelOpenaiGpt56Sol,
    modelOpenaiGpt56Terra,
    modelZaiGlm47Flash,
    modelZaiGlm5,
} from "./models.js";
import { createBedrockProvider } from "./bedrock.js";
import {
    createBedrockOpenAIClient,
    type BedrockOpenAIClient,
} from "./createBedrockOpenAIClient.js";
import { createBedrockOpenAIRequest } from "./createBedrockOpenAIRequest.js";
import type { PiBedrockRuntimeStream } from "./createBedrockRuntimeStream.js";
import { getBedrockModelRoute } from "./getBedrockModelRoute.js";
import { resolveBedrockRuntimeModelId } from "./resolveBedrockRuntimeModelId.js";

describe("Amazon Bedrock provider", () => {
    it("requires the Bedrock bearer token", () => {
        expect(() => createBedrockProvider({ env: {} })).toThrow("AWS_BEARER_TOKEN_BEDROCK");
    });

    it("keeps an explicit endpoint map and prefers Runtime when possible", () => {
        for (const route of BEDROCK_MODEL_ROUTES) {
            expect(route.endpoints).toContain(route.preferredEndpoint);
            expect(route.preferredEndpoint).toBe(
                route.endpoints.includes("bedrock-runtime") ? "bedrock-runtime" : "bedrock-mantle",
            );
        }
    });

    it("uses only AWS-documented regional inference profiles", () => {
        const route = getBedrockModelRoute(modelAnthropicSonnet5.id);
        expect(route).toBeDefined();
        expect(resolveBedrockRuntimeModelId(route!, "us-east-1")).toBe(
            "us.anthropic.claude-sonnet-5",
        );
        expect(resolveBedrockRuntimeModelId(route!, "eu-west-1")).toBe(
            "global.anthropic.claude-sonnet-5",
        );
    });

    it("selects image and tool profiles from each model's native provider", () => {
        const provider = createBedrockProvider({
            bearerToken: "bedrock-token",
            region: "us-east-1",
        });

        expect(provider.imageProfile(modelAnthropicOpus48)).toBe("claude");
        expect(provider.imageProfile(modelOpenaiGpt56Sol)).toBe("codex");
        expect(provider.toolProfile(modelAnthropicOpus48)).toBe("claude");
        expect(provider.toolProfile(modelOpenaiGpt56Sol)).toBe("codex");
        expect(provider.toolProfile(modelZaiGlm5)).toBe("pi");
    });

    it("routes Anthropic models through Bedrock Runtime with adaptive thinking", async () => {
        const piStream = {} as AssistantMessageEventStream;
        const streamRuntime = vi.fn(
            ((..._args: Parameters<PiBedrockRuntimeStream>) => piStream) as PiBedrockRuntimeStream,
        );
        const provider = createBedrockProvider({
            bearerToken: "bedrock-token",
            region: "us-east-1",
            streamRuntime,
        });

        provider.stream(modelAnthropicOpus48, { messages: [] }, { thinking: "max" });

        expect(streamRuntime).toHaveBeenCalledOnce();
        const [piModel, , streamOptions] = streamRuntime.mock.calls[0] ?? [];
        expect(piModel).toMatchObject({
            api: "bedrock-converse-stream",
            baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
            id: "us.anthropic.claude-opus-4-8",
            provider: "bedrock",
        });
        expect(streamOptions).toMatchObject({
            bearerToken: "bedrock-token",
            maxTokens: 128_000,
            region: "us-east-1",
        });
        const payload = await streamOptions?.onPayload?.({ messages: [] }, piModel!);
        expect(payload).toMatchObject({
            additionalModelRequestFields: {
                output_config: { effort: "max" },
                thinking: { display: "summarized", type: "adaptive" },
            },
        });
    });

    it("routes GLM through native Bedrock Runtime Converse", async () => {
        const piStream = {} as AssistantMessageEventStream;
        const streamRuntime = vi.fn(
            ((..._args: Parameters<PiBedrockRuntimeStream>) => piStream) as PiBedrockRuntimeStream,
        );
        const provider = createBedrockProvider({
            bearerToken: "bedrock-token",
            region: "us-east-1",
            streamRuntime,
        });

        provider.stream(modelZaiGlm5, { messages: [] }, { thinking: "high" });

        expect(streamRuntime).toHaveBeenCalledOnce();
        expect(streamRuntime.mock.calls[0]?.[0]).toMatchObject({
            api: "bedrock-converse-stream",
            id: "zai.glm-5",
            input: ["text"],
            reasoning: true,
        });
        expect(streamRuntime.mock.calls[0]?.[2]).toMatchObject({
            bearerToken: "bedrock-token",
            maxTokens: 32_000,
            region: "us-east-1",
        });
        const glmPayload = await streamRuntime.mock.calls[0]?.[2]?.onPayload?.(
            { messages: [] },
            streamRuntime.mock.calls[0]![0],
        );
        expect(glmPayload).toMatchObject({
            additionalModelRequestFields: {
                reasoning_effort: "high",
                thinking: { type: "enabled" },
            },
        });
    });

    it("uses the models' native thinking levels instead of synthetic token budgets", async () => {
        const piStream = {} as AssistantMessageEventStream;
        const streamRuntime = vi.fn(
            ((..._args: Parameters<PiBedrockRuntimeStream>) => piStream) as PiBedrockRuntimeStream,
        );
        const provider = createBedrockProvider({
            bearerToken: "bedrock-token",
            region: "us-east-1",
            streamRuntime,
        });

        provider.stream(modelZaiGlm47Flash, { messages: [] }, { thinking: "off" });
        provider.stream(modelZaiGlm5, { messages: [] }, { thinking: "max" });

        expect(modelZaiGlm47Flash.thinkingLevels).toEqual(["off", "on"]);
        expect(modelZaiGlm5.thinkingLevels).toEqual(["off", "high", "max"]);

        const glmOffPayload = await streamRuntime.mock.calls[0]?.[2]?.onPayload?.(
            { messages: [] },
            streamRuntime.mock.calls[0]![0],
        );
        expect(glmOffPayload).toMatchObject({
            additionalModelRequestFields: {
                thinking: { type: "disabled" },
            },
        });
        expect(
            (glmOffPayload as { additionalModelRequestFields?: Record<string, unknown> })
                .additionalModelRequestFields,
        ).not.toHaveProperty("reasoning_effort");

        const glmMaxPayload = await streamRuntime.mock.calls[1]?.[2]?.onPayload?.(
            { messages: [] },
            streamRuntime.mock.calls[1]![0],
        );
        expect(glmMaxPayload).toMatchObject({
            additionalModelRequestFields: {
                reasoning_effort: "max",
                thinking: { type: "enabled" },
            },
        });
        expect(streamRuntime.mock.calls[0]?.[2]?.maxTokens).toBe(4_000);
        expect(streamRuntime.mock.calls[1]?.[2]?.maxTokens).toBe(32_000);
    });

    it("uses the official OpenAI Bedrock client without automatic request replay", () => {
        const client = createBedrockOpenAIClient({
            bearerToken: "bedrock-token",
            region: "us-east-1",
        });

        expect(client).toBeInstanceOf(BedrockOpenAI);
        expect(client.baseURL).toBe("https://bedrock-mantle.us-east-1.api.aws/openai/v1");
        expect(client.maxRetries).toBe(0);
    });

    it("reuses one Bedrock Mantle client for sequential inference calls from the same agent", async () => {
        const response = {
            id: "response-reused-client",
            model: "openai.gpt-5.6-sol",
            status: "completed",
            usage: {
                input_tokens: 1,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 1,
                total_tokens: 2,
            },
        } as unknown as Response;
        const create = vi.fn(() => ({
            async *[Symbol.asyncIterator]() {
                yield { type: "response.completed" as const, response };
            },
        }));
        const openAIClientFactory = vi.fn(
            () => ({ responses: { create } }) as unknown as BedrockOpenAIClient,
        );
        const provider = createBedrockProvider({
            bearerToken: "bedrock-token",
            openAIClientFactory,
            region: "us-east-1",
        });

        await provider.stream(modelOpenaiGpt56Sol, { messages: [] }).result();
        await provider.stream(modelOpenaiGpt56Sol, { messages: [] }).result();

        expect(create).toHaveBeenCalledTimes(2);
        expect(openAIClientFactory).toHaveBeenCalledOnce();
    });

    it("uses a custom Mantle endpoint verbatim", () => {
        const client = createBedrockOpenAIClient({
            bearerToken: "bedrock-token",
            endpoint: "https://mantle.example/openai/v1",
            region: "us-west-2",
        });

        expect(client.baseURL).toBe("https://mantle.example/openai/v1");
    });

    it("sends an explicit none effort when OpenAI thinking is off", () => {
        const modelRoute = getBedrockModelRoute(modelOpenaiGpt56Sol.id);
        expect(modelRoute).toBeDefined();

        const request = createBedrockOpenAIRequest({
            context: { messages: [] },
            modelRoute: modelRoute!,
            streamOptions: { thinking: "off" },
        });

        expect(request.reasoning).toEqual({ effort: "none" });
        expect(request.include).toBeUndefined();
        expect(request.max_output_tokens).toBeUndefined();
    });

    it("matches the official Codex Bedrock Responses request controls", () => {
        const modelRoute = getBedrockModelRoute(modelOpenaiGpt56Sol.id);
        expect(modelRoute).toBeDefined();

        const request = createBedrockOpenAIRequest({
            agentId: "agent-123",
            context: {
                messages: [],
                tools: [
                    {
                        kind: "custom",
                        name: "apply_patch",
                        description: "Apply a patch.",
                        format: {
                            type: "grammar",
                            syntax: "lark",
                            definition: "start: /[\\s\\S]+/",
                        },
                    },
                ],
            },
            installationId: "installation-123",
            modelRoute: modelRoute!,
            streamOptions: { sessionId: "turn-123", thinking: "low" },
            turnStartedAt: 123_456,
        });

        expect(request).toMatchObject({
            client_metadata: {
                session_id: "agent-123",
                thread_id: "agent-123",
                turn_id: "turn-123",
                "x-codex-installation-id": "installation-123",
                "x-codex-window-id": "agent-123:0",
            },
            include: ["reasoning.encrypted_content"],
            parallel_tool_calls: true,
            prompt_cache_key: "agent-123",
            reasoning: { effort: "low" },
            text: { verbosity: "low" },
            tool_choice: "auto",
            tools: [
                expect.objectContaining({
                    type: "custom",
                    name: "apply_patch",
                    format: {
                        type: "grammar",
                        syntax: "lark",
                        definition: "start: /[\\s\\S]+/",
                    },
                }),
            ],
        });
        expect(request.reasoning).not.toHaveProperty("summary");
    });

    it("uses the documented GPT-5.6 Bedrock model IDs and limits", () => {
        for (const [model, apiModelId] of [
            [modelOpenaiGpt56Sol, "openai.gpt-5.6-sol"],
            [modelOpenaiGpt56Terra, "openai.gpt-5.6-terra"],
            [modelOpenaiGpt56Luna, "openai.gpt-5.6-luna"],
        ] as const) {
            const route = getBedrockModelRoute(model.id);
            expect(route).toMatchObject({
                apiModelId,
                contextWindow: 272_000,
                endpoints: ["bedrock-mantle"],
                maxTokens: 128_000,
                preferredEndpoint: "bedrock-mantle",
            });
            expect(route?.model.contextWindow).toBe(272_000);
            expect(route?.model.thinkingLevels).toContain("max");
            expect(route?.model.thinkingLevels).not.toContain("ultra");
        }

        const solRoute = getBedrockModelRoute(modelOpenaiGpt56Sol.id);
        const request = createBedrockOpenAIRequest({
            context: { messages: [] },
            modelRoute: solRoute!,
            streamOptions: { thinking: "max" },
        });
        expect(request).toMatchObject({
            model: "openai.gpt-5.6-sol",
            reasoning: { effort: "max" },
        });
    });

    it("routes OpenAI models through the official Bedrock OpenAI Responses client", async () => {
        const response = {
            end_turn: false,
            id: "response-1",
            model: "openai.gpt-5.6-sol",
            status: "completed",
            usage: {
                input_tokens: 12,
                input_tokens_details: {
                    cached_tokens: 2,
                    cache_write_tokens: 1,
                },
                output_tokens: 3,
                output_tokens_details: { reasoning_tokens: 0 },
                total_tokens: 15,
            },
        } as unknown as Response;
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
                    delta: "Hello from Bedrock",
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
                                text: "Hello from Bedrock",
                                annotations: [],
                            },
                        ],
                    },
                };
                yield { type: "response.completed" as const, response };
            },
        };
        const create = vi.fn(() => responseStream);
        const openAIClient = {
            responses: { create },
        } as unknown as BedrockOpenAIClient;
        const piStream = {} as AssistantMessageEventStream;
        const streamRuntime = vi.fn(
            ((..._args: Parameters<PiBedrockRuntimeStream>) => piStream) as PiBedrockRuntimeStream,
        );
        const provider = createBedrockProvider({
            bearerToken: "bedrock-token",
            openAIClient,
            region: "us-east-1",
            streamRuntime,
        });

        const message = await provider
            .stream(modelOpenaiGpt56Sol, { messages: [] }, { thinking: "xhigh" })
            .result();

        expect(create).toHaveBeenCalledOnce();
        expect(streamRuntime).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "openai.gpt-5.6-sol",
                reasoning: { effort: "xhigh" },
                store: false,
                stream: true,
            }),
        );
        expect(message).toMatchObject({
            content: [{ type: "text", text: "Hello from Bedrock" }],
            provider: "bedrock",
            responseId: "response-1",
            responseModel: "openai.gpt-5.6-sol",
            endTurn: false,
            stopReason: "stop",
            usage: {
                input: 9,
                output: 3,
                cacheRead: 2,
                cacheWrite: 1,
                totalTokens: 15,
            },
        });
    });

    it("preserves an incomplete response reason as a retryable stream error", async () => {
        const response = {
            id: "response-incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            model: "openai.gpt-5.6-sol",
            status: "incomplete",
        } as unknown as Response;
        const responseStream = {
            async *[Symbol.asyncIterator]() {
                yield { type: "response.incomplete" as const, response };
            },
        };
        const openAIClient = {
            responses: { create: vi.fn(() => responseStream) },
        } as unknown as BedrockOpenAIClient;
        const provider = createBedrockProvider({
            bearerToken: "bedrock-token",
            openAIClient,
            region: "us-east-1",
        });

        const message = await provider.stream(modelOpenaiGpt56Sol, { messages: [] }).result();

        expect(message).toMatchObject({
            errorCode: "incomplete_response",
            errorMessage: "Incomplete response returned, reason: max_output_tokens",
            stopReason: "error",
        });
    });

    it("only exposes Mantle models in regions where AWS serves them", () => {
        const provider = createBedrockProvider({
            bearerToken: "bedrock-token",
            region: "us-west-2",
        });

        expect(provider.models.map((model) => model.id)).toContain(modelOpenaiGpt56Terra.id);
        expect(provider.models.map((model) => model.id)).toContain(modelOpenaiGpt56Luna.id);
        expect(provider.models.map((model) => model.id)).not.toContain(modelOpenaiGpt56Sol.id);
    });

    it("uses model-specific regions and endpoints for availability and routing", () => {
        const piStream = {} as AssistantMessageEventStream;
        const streamRuntime = vi.fn(
            ((..._args: Parameters<PiBedrockRuntimeStream>) => piStream) as PiBedrockRuntimeStream,
        );
        const provider = createBedrockProvider({
            bearerToken: "bedrock-token",
            modelOverrides: {
                [modelAnthropicOpus48.id]: { endpoint: "https://runtime.example" },
                [modelOpenaiGpt56Sol.id]: {
                    endpoint: "https://mantle.example/openai/v1",
                },
                [modelOpenaiGpt56Terra.id]: { region: "us-east-1" },
            },
            region: "private-region-1",
            streamRuntime,
        });

        expect(provider.models.map((model) => model.id)).toContain(modelOpenaiGpt56Sol.id);
        expect(provider.models.map((model) => model.id)).toContain(modelOpenaiGpt56Terra.id);
        provider.stream(modelAnthropicOpus48, { messages: [] });
        expect(streamRuntime.mock.calls[0]?.[0]).toMatchObject({
            baseUrl: "https://runtime.example",
        });
        expect(streamRuntime.mock.calls[0]?.[2]).toMatchObject({ region: "private-region-1" });
    });

    it("exposes every GPT-5.6 variant in its documented US East regions", () => {
        for (const region of ["us-east-1", "us-east-2"]) {
            const provider = createBedrockProvider({
                bearerToken: "bedrock-token",
                region,
            });

            expect(provider.models.map((model) => model.id)).toEqual(
                expect.arrayContaining([
                    modelOpenaiGpt56Sol.id,
                    modelOpenaiGpt56Terra.id,
                    modelOpenaiGpt56Luna.id,
                ]),
            );
        }
    });

    it("applies the manual in-region availability map for GLM", () => {
        const usProvider = createBedrockProvider({
            bearerToken: "bedrock-token",
            region: "us-east-1",
        });
        const frankfurtProvider = createBedrockProvider({
            bearerToken: "bedrock-token",
            region: "eu-central-1",
        });

        expect(usProvider.models).toEqual(
            expect.arrayContaining([modelZaiGlm5, modelZaiGlm47Flash]),
        );
        expect(frankfurtProvider.models).toContain(modelZaiGlm47Flash);
        expect(frankfurtProvider.models).not.toContain(modelZaiGlm5);
    });

    it("does not expose commercial Runtime models in unsupported AWS partitions", () => {
        const provider = createBedrockProvider({
            bearerToken: "bedrock-token",
            region: "us-gov-west-1",
        });

        expect(provider.models).toEqual([]);
        expect(provider.models).not.toContain(modelAnthropicOpus48);
    });
});
