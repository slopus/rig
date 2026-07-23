import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const read_mcp_resource = {
    name: "read_mcp_resource",
    type: "local",
    description:
        "Read a specific resource from an MCP server given the server name and resource URI.",
    parameters: Type.Object(
        {
            server: Type.String({
                description:
                    "MCP server name exactly as configured. Must match the 'server' field returned by list_mcp_resources.",
            }),
            uri: Type.String({
                description:
                    "Resource URI to read. Must be one of the URIs returned by list_mcp_resources.",
            }),
        },
        { additionalProperties: false },
    ),
} as const satisfies SessionTool;
