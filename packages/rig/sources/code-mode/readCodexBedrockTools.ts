import { readFileSync } from "node:fs";

import type { Tool } from "../providers/types.js";

export function readCodexBedrockTools(): readonly Tool[] {
    const tools = JSON.parse(
        readFileSync(
            new URL("../profiles/codex/codex-bedrock-tools.json", import.meta.url),
            "utf8",
        ),
    ) as readonly Record<string, unknown>[];
    return tools.map((tool) => {
        if (tool.type === "custom") {
            return {
                kind: "custom",
                name: tool.name,
                description: tool.description,
                ...(tool.format === undefined ? {} : { format: tool.format }),
            } as Tool;
        }
        if (tool.type === "tool_search") {
            return {
                kind: "tool_search",
                name: "tool_search",
                description: tool.description,
                execution: tool.execution,
                parameters: tool.parameters,
            } as Tool;
        }
        return {
            kind: "function",
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        } as Tool;
    });
}
