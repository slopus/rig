import { createServer } from "node:http";
import { describe, expect, it } from "vitest";

import {
    Executor,
    modelAnthropicOpus48,
    modelOpenaiGpt56Luna,
    modelOpenaiGpt56Sol,
    modelOpenaiGpt56Terra,
} from "@slopus/rig-execution";
import { bedrockExecution } from "./bedrockExecution.js";
import { getBedrockModelRoute } from "./getBedrockModelRoute.js";

describe("Amazon Bedrock provider", () => {
    it("requires the Bedrock bearer token", () => {
        expect(() => bedrockExecution({ env: {} })).toThrow("AWS_BEARER_TOKEN_BEDROCK");
    });

    it("uses Rig model IDs and Bedrock-specific limits", () => {
        for (const model of [modelOpenaiGpt56Sol, modelOpenaiGpt56Terra, modelOpenaiGpt56Luna]) {
            const route = getBedrockModelRoute(model.id);
            expect(route?.model.id).toBe(model.id);
            expect(route?.model.contextWindow).toBe(272_000);
            expect(route?.model.thinkingLevels).toContain("max");
            expect(route?.model.thinkingLevels).not.toContain("ultra");
        }
    });

    it("routes OpenAI models through the rig-providers Bedrock session", async () => {
        let requestBody: Record<string, unknown> | undefined;
        const server = createServer(async (request, response) => {
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(Buffer.from(chunk));
            requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            response.writeHead(200, { "content-type": "text/event-stream" });
            response.end(
                [
                    'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"message-1","role":"assistant","status":"in_progress","content":[]}}',
                    'data: {"type":"response.output_text.delta","output_index":0,"delta":"ok"}',
                    'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"message-1","role":"assistant","status":"completed","content":[{"type":"output_text","text":"ok","annotations":[]}]}}',
                    'data: {"type":"response.completed","response":{"id":"response-1","model":"openai.gpt-5.6-sol","status":"completed","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}',
                    "data: [DONE]",
                    "",
                ].join("\n\n"),
            );
        });
        await new Promise<void>((resolve, reject) => {
            server.listen(0, "127.0.0.1", resolve);
            server.once("error", reject);
        });
        const address = server.address();
        if (typeof address !== "object" || address === null) expect.fail("Missing server port.");
        const endpoint = `http://127.0.0.1:${address.port}/openai/v1`;
        const provider = new Executor([
            bedrockExecution({
                bearerToken: "bedrock-token",
                modelOverrides: { [modelOpenaiGpt56Sol.id]: { endpoint } },
                region: "us-east-1",
            }),
        ]);

        try {
            const message = await provider
                .stream(modelOpenaiGpt56Sol, {
                    messages: [{ role: "user", content: "Reply with ok.", timestamp: 1 }],
                })
                .result();

            expect(requestBody).toMatchObject({
                model: "openai.gpt-5.6-sol",
                stream: true,
            });
            expect(message).toMatchObject({
                content: [{ type: "text", text: "ok" }],
                provider: "bedrock",
                stopReason: "stop",
            });
        } finally {
            await provider.close?.();
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => {
                server.close((error) => (error === undefined ? resolve() : reject(error)));
            });
        }
    });

    it("only exposes Mantle models in regions where AWS serves them", () => {
        const provider = new Executor([
            bedrockExecution({
                bearerToken: "bedrock-token",
                region: "us-west-2",
            }),
        ]);

        expect(provider.models.map((model) => model.id)).toContain(modelOpenaiGpt56Terra.id);
        expect(provider.models.map((model) => model.id)).toContain(modelOpenaiGpt56Luna.id);
        expect(provider.models.map((model) => model.id)).not.toContain(modelOpenaiGpt56Sol.id);
    });

    it("uses model-specific regions and endpoints for availability", () => {
        const provider = new Executor([
            bedrockExecution({
                bearerToken: "bedrock-token",
                modelOverrides: {
                    [modelAnthropicOpus48.id]: { endpoint: "https://runtime.example" },
                    [modelOpenaiGpt56Sol.id]: {
                        endpoint: "https://mantle.example/openai/v1",
                    },
                    [modelOpenaiGpt56Terra.id]: { region: "us-east-1" },
                },
                region: "private-region-1",
            }),
        ]);

        expect(provider.models.map((model) => model.id)).toContain(modelOpenaiGpt56Sol.id);
        expect(provider.models.map((model) => model.id)).toContain(modelOpenaiGpt56Terra.id);
        expect(provider.models.map((model) => model.id)).toContain(modelAnthropicOpus48.id);
    });

    it("exposes every GPT-5.6 variant in its documented US East regions", () => {
        for (const region of ["us-east-1", "us-east-2"]) {
            const provider = new Executor([
                bedrockExecution({
                    bearerToken: "bedrock-token",
                    region,
                }),
            ]);

            expect(provider.models.map((model) => model.id)).toEqual(
                expect.arrayContaining([
                    modelOpenaiGpt56Sol.id,
                    modelOpenaiGpt56Terra.id,
                    modelOpenaiGpt56Luna.id,
                ]),
            );
        }
    });

    it("does not expose commercial models in unsupported AWS partitions", () => {
        const provider = new Executor([
            bedrockExecution({
                bearerToken: "bedrock-token",
                region: "us-gov-west-1",
            }),
        ]);

        expect(provider.models).toEqual([]);
        expect(provider.models).not.toContain(modelAnthropicOpus48);
    });
});
