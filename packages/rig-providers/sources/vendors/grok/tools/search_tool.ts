import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const search_tool = {
    name: "search_tool",
    type: "local",
    description:
        'Search for MCP tools by keyword and retrieve their input schemas.\n\nIf status is "partial", some servers may still be connecting.',
    parameters: Type.Object(
        {
            query: Type.String({
                description:
                    'Keywords to match against tool names, server names, and descriptions.\nInclude the server name and action for best results\n(e.g. "linear create issue", "slack read thread history").',
            }),
            limit: Type.Optional(
                Type.Unsafe({
                    description: "Maximum number of results to return (default 5).",
                    type: ["integer", "null"],
                    format: "uint8",
                    minimum: 0,
                    maximum: 255,
                    default: 5,
                }),
            ),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "SearchToolInput",
            description: "Input for the `search_tool` tool.",
        },
    ),
} as const satisfies SessionTool;
