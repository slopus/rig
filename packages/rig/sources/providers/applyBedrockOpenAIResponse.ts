import type { Response } from "openai/resources/responses/responses.js";

import type { AssistantMessage } from "./types.js";

export function applyBedrockOpenAIResponse(
    partial: AssistantMessage,
    response: Response,
): Extract<AssistantMessage["stopReason"], "stop" | "toolUse"> {
    partial.responseId = response.id;
    partial.responseModel = response.model;
    const endTurn = (response as Response & { end_turn?: unknown }).end_turn;
    if (typeof endTurn === "boolean") partial.endTurn = endTurn;
    const cachedTokens = response.usage?.input_tokens_details.cached_tokens ?? 0;
    const cacheWriteTokens = response.usage?.input_tokens_details.cache_write_tokens ?? 0;
    partial.usage = {
        input: Math.max(0, (response.usage?.input_tokens ?? 0) - cachedTokens - cacheWriteTokens),
        output: response.usage?.output_tokens ?? 0,
        cacheRead: cachedTokens,
        cacheWrite: cacheWriteTokens,
        totalTokens: response.usage?.total_tokens ?? 0,
        cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
        },
    };
    partial.stopReason = "stop";
    if (partial.content.some((content) => content.type === "toolCall")) {
        partial.stopReason = "toolUse";
    }
    return partial.stopReason;
}
