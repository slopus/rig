import type { Tool as OpenAIResponseTool } from "openai/resources/responses/responses.js";

import type { Tool } from "./types.js";

export function toOpenAIResponseTools(tools: readonly Tool[]): OpenAIResponseTool[] {
    return tools.map((tool) => {
        if (tool.kind === "tool_search") {
            return {
                type: "tool_search",
                execution: tool.execution,
                description: tool.description,
                parameters: tool.parameters,
            } as OpenAIResponseTool;
        }
        if (tool.kind === "namespace") {
            return {
                type: "namespace",
                name: tool.name,
                description: tool.description,
                tools: toOpenAIResponseTools(tool.tools),
            } as OpenAIResponseTool;
        }
        return tool.kind === "custom"
            ? {
                  type: "custom",
                  name: tool.name,
                  description: tool.description,
                  ...(tool.format === undefined ? {} : { format: tool.format }),
              }
            : {
                  type: "function",
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters as unknown as Record<string, unknown>,
                  strict: false,
                  ...(tool.deferLoading === undefined ? {} : { defer_loading: tool.deferLoading }),
              };
    });
}
