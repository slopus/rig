import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import type { BedrockModelRoute } from "./bedrock-model-routes.js";
import { toOpenAIResponseInput } from "./toOpenAIResponseInput.js";
import { toOpenAIResponseTools } from "./toOpenAIResponseTools.js";
import { toOpenAIReasoningEffort } from "./toOpenAIReasoningEffort.js";
import type { Context, StreamOptions } from "./types.js";

export function createBedrockOpenAIRequest(options: {
    context: Context;
    modelRoute: BedrockModelRoute;
    streamOptions?: StreamOptions;
}): ResponseCreateParamsStreaming {
    const effort = options.streamOptions?.thinking ?? options.modelRoute.model.defaultThinkingLevel;
    const reasoningEffort = toOpenAIReasoningEffort(effort);
    const tools = options.context.tools ?? [];

    return {
        model: options.modelRoute.mantleApiModelId ?? options.modelRoute.apiModelId,
        input: toOpenAIResponseInput(options.context),
        stream: true,
        store: false,
        max_output_tokens: options.modelRoute.maxTokens,
        ...(options.context.systemPrompt !== undefined
            ? { instructions: options.context.systemPrompt }
            : {}),
        ...(tools.length > 0 ? { tools: toOpenAIResponseTools(tools) } : {}),
        ...(reasoningEffort !== undefined
            ? {
                  reasoning: {
                      effort: reasoningEffort,
                      ...(reasoningEffort === "none" ? {} : { summary: "auto" as const }),
                  },
                  ...(reasoningEffort === "none"
                      ? {}
                      : { include: ["reasoning.encrypted_content" as const] }),
              }
            : {}),
    };
}
