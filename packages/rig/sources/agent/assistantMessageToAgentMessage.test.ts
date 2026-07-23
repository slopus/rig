import { describe, expect, it } from "vitest";

import { assistantMessageToAgentMessage } from "./assistantMessageToAgentMessage.js";
import { toProviderMessages } from "./loop.js";
import { modelOpenaiGpt56Sol } from "@slopus/rig-execution";
import type { AssistantMessage } from "@slopus/rig-execution";

describe("assistantMessageToAgentMessage", () => {
    it("durably records requested and response model attribution", () => {
        const message = assistantMessageToAgentMessage(
            providerMessage({ responseModel: "gpt-5.6-2026-07-01" }),
            () => "fallback",
            { providerId: "codex", requestedModelId: "openai/gpt-5.6" },
        );

        expect(message).toMatchObject({
            providerId: "codex",
            requestedModelId: "openai/gpt-5.6",
            responseModel: "gpt-5.6-2026-07-01",
        });
    });

    it("stores a model-invisible tool call presentation on the durable block", () => {
        const source = providerMessage();
        const message = assistantMessageToAgentMessage(
            {
                ...source,
                content: [
                    {
                        type: "toolCall",
                        id: "call-1",
                        name: "read",
                        arguments: { path: "src/index.ts" },
                    },
                ],
            },
            () => "fallback",
            { providerId: "pi", requestedModelId: "openai/gpt-5.6" },
            () => ({
                type: "exploration",
                operations: [{ kind: "read", name: "index.ts" }],
            }),
        );

        expect(message.blocks).toEqual([
            {
                type: "tool_call",
                id: "call-1",
                name: "read",
                arguments: { path: "src/index.ts" },
                presentation: {
                    type: "exploration",
                    operations: [{ kind: "read", name: "index.ts" }],
                },
            },
        ]);
    });

    it("preserves a function namespace through the durable agent transcript", () => {
        const source = providerMessage();
        const message = assistantMessageToAgentMessage(
            {
                ...source,
                content: [
                    {
                        type: "toolCall",
                        id: "call-spawn",
                        namespace: "collaboration",
                        name: "spawn_agent",
                        arguments: { task_name: "audit" },
                    },
                ],
            },
            () => "fallback",
            { providerId: "codex", requestedModelId: modelOpenaiGpt56Sol.id },
        );

        expect(message.blocks).toEqual([
            {
                type: "tool_call",
                id: "call-spawn",
                namespace: "collaboration",
                name: "spawn_agent",
                arguments: { task_name: "audit" },
            },
        ]);
        expect(
            toProviderMessages([message], {
                model: modelOpenaiGpt56Sol,
                now: () => 2,
                providerId: "codex",
            }),
        ).toMatchObject([
            {
                content: [
                    {
                        type: "toolCall",
                        id: "call-spawn",
                        namespace: "collaboration",
                        name: "spawn_agent",
                    },
                ],
            },
        ]);
    });
});

function providerMessage(options: { responseModel?: string } = {}): AssistantMessage {
    return {
        api: "responses",
        content: [{ text: "hello", type: "text" }],
        model: "openai/gpt-5.6",
        provider: "openai-codex",
        responseId: "response-1",
        role: "assistant",
        stopReason: "stop",
        timestamp: 1,
        usage: {
            cacheRead: 3,
            cacheWrite: 4,
            cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
            input: 10,
            output: 2,
            totalTokens: 19,
        },
        ...(options.responseModel === undefined ? {} : { responseModel: options.responseModel }),
    };
}
