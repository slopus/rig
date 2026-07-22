import type { KimiChatTool } from "./kimi-chat-types.js";
import { normalizeKimiToolSchema } from "./normalizeKimiToolSchema.js";
import type { Tool } from "./types.js";

export function toKimiChatTools(tools: readonly Tool[]): readonly KimiChatTool[] {
    return tools.map((tool) => {
        if (tool.kind === "custom" || tool.kind === "namespace") {
            throw new Error(`Kimi does not support custom tool '${tool.name}'.`);
        }
        return {
            function: {
                description: tool.description,
                name: tool.name,
                parameters: normalizeKimiToolSchema(tool.parameters as Record<string, unknown>),
            },
            type: "function" as const,
        };
    });
}
