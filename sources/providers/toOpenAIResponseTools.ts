import type { FunctionTool } from "openai/resources/responses/responses.js";

import type { Tool } from "./types.js";

export function toOpenAIResponseTools(tools: readonly Tool[]): FunctionTool[] {
    return tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as unknown as Record<string, unknown>,
        strict: false,
    }));
}
