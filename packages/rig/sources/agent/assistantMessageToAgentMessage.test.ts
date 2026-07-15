import { describe, expect, it } from "vitest";

import { assistantMessageToAgentMessage } from "./assistantMessageToAgentMessage.js";
import type { AssistantMessage } from "../providers/types.js";

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

    it("keeps legacy conversion backward compatible when attribution is unavailable", () => {
        const message = assistantMessageToAgentMessage(providerMessage(), () => "fallback");

        expect(message).not.toHaveProperty("providerId");
        expect(message).not.toHaveProperty("requestedModelId");
        expect(message).not.toHaveProperty("responseModel");
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
