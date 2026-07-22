import { readFileSync } from "node:fs";
import type { TSchema } from "@sinclair/typebox";

import type { NamespaceTool, ToolSearchTool } from "../providers/types.js";

export function readCodexBedrockDeferredTools(): {
    namespace: NamespaceTool;
    toolSearch: ToolSearchTool;
} {
    const value = JSON.parse(
        readFileSync(
            new URL("../profiles/codex/codex-bedrock-deferred-tools.json", import.meta.url),
            "utf8",
        ),
    ) as {
        namespace: {
            name: string;
            description: string;
            tools: readonly {
                type: "function";
                name: string;
                description: string;
                parameters: TSchema;
                defer_loading?: boolean;
            }[];
        };
        toolSearch: Omit<ToolSearchTool, "kind" | "name"> & { type: "tool_search" };
    };
    return {
        namespace: {
            kind: "namespace",
            name: value.namespace.name,
            description: value.namespace.description,
            tools: value.namespace.tools.map((tool) => ({
                kind: "function" as const,
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
                ...(tool.defer_loading === undefined ? {} : { deferLoading: tool.defer_loading }),
            })),
        },
        toolSearch: {
            kind: "tool_search",
            name: "tool_search",
            description: value.toolSearch.description,
            execution: value.toolSearch.execution,
            parameters: value.toolSearch.parameters as ToolSearchTool["parameters"],
        },
    };
}
