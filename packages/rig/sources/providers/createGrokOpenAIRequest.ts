import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import { toOpenAIResponseInput } from "./toOpenAIResponseInput.js";
import { toOpenAIResponseTools } from "./toOpenAIResponseTools.js";
import { toOpenAIReasoningEffort } from "./toOpenAIReasoningEffort.js";
import type { Context, Model, StreamOptions } from "./types.js";

export function createGrokOpenAIRequest(options: {
    apiModelId: string;
    context: Context;
    model: Model;
    streamOptions?: StreamOptions;
}): ResponseCreateParamsStreaming {
    const effort = options.streamOptions?.thinking ?? options.model.defaultThinkingLevel;
    const reasoningEffort =
        options.model.thinkingLevels.length === 1 && options.model.thinkingLevels[0] === "off"
            ? undefined
            : toOpenAIReasoningEffort(effort);
    const tools = options.context.tools ?? [];
    return {
        model: options.apiModelId,
        input: toOpenAIResponseInput(options.context),
        stream: true,
        store: false,
        temperature: 0.7,
        top_p: 0.95,
        include: ["reasoning.encrypted_content"],
        reasoning: {
            summary: "concise",
            ...(reasoningEffort === undefined ? {} : { effort: reasoningEffort }),
        },
        ...(options.context.systemPrompt === undefined
            ? {}
            : { instructions: options.context.systemPrompt }),
        ...(tools.length === 0 ? {} : { tools: toOpenAIResponseTools(tools) }),
    };
}
