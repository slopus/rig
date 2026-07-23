import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import type { SessionContext } from "@/core/SessionContext.js";
import type { SessionReasoningEffort } from "@/core/SessionRunRequest.js";
import type { SessionTool } from "@/core/SessionTool.js";
import { resolveGrokReasoningEffort } from "@/vendors/grok/impl/resolveGrokReasoningEffort.js";
import { toGrokResponseInput } from "@/vendors/grok/impl/toGrokResponseInput.js";
import { toGrokToolDefinitions } from "@/vendors/grok/impl/toGrokToolDefinitions.js";

export function createGrokOpenAIRequest(options: {
    apiModelId: string;
    context: SessionContext;
    effort?: SessionReasoningEffort;
    tools?: readonly SessionTool[];
    compaction?: boolean;
}): ResponseCreateParamsStreaming {
    const reasoningEffort = resolveGrokReasoningEffort(options.apiModelId, options.effort);

    return {
        model: options.apiModelId,
        input: toGrokResponseInput(options.context),
        stream: true,
        store: false,
        include: ["reasoning.encrypted_content"],
        reasoning: {
            summary: "concise",
            ...(reasoningEffort === undefined ? {} : { effort: reasoningEffort }),
        },
        ...(options.compaction === true
            ? {
                  temperature: 1,
                  ...(options.tools !== undefined && options.tools.length > 0
                      ? { tool_choice: "auto" as const }
                      : {}),
              }
            : {}),
        ...(options.tools === undefined
            ? {}
            : { tools: toGrokToolDefinitions(options.tools) as never }),
    };
}
