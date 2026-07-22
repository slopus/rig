import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import { normalizeCodexThinkingLevel } from "./normalizeCodexThinkingLevel.js";
import { toOpenAIResponseInput } from "./toOpenAIResponseInput.js";
import { toOpenAIResponseTools } from "./toOpenAIResponseTools.js";
import type { Context, StreamOptions } from "./types.js";

export function createCodexOpenAIRequest(options: {
    context: Context;
    modelId: string;
    streamOptions?: StreamOptions;
}): ResponseCreateParamsStreaming {
    const effort = normalizeCodexThinkingLevel(options.streamOptions?.thinking ?? "medium");
    const tools = options.context.tools ?? [];
    return {
        model: options.modelId,
        input: toOpenAIResponseInput(options.context),
        stream: true,
        store: false,
        parallel_tool_calls: !tools.some((tool) => tool.kind === "custom"),
        ...(options.context.systemPrompt === undefined
            ? {}
            : { instructions: options.context.systemPrompt }),
        ...(tools.length === 0 ? {} : { tools: toOpenAIResponseTools(tools) }),
        ...(options.streamOptions?.serviceTier === "fast" ? { service_tier: "priority" } : {}),
        ...(effort === "off"
            ? {}
            : {
                  reasoning: {
                      effort: effort === "ultra" ? "max" : effort,
                      summary: "auto",
                  },
                  include: ["reasoning.encrypted_content"],
              }),
        text: { verbosity: "low" },
    } as ResponseCreateParamsStreaming;
}
