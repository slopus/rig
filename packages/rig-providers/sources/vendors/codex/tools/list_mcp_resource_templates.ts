import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const list_mcp_resource_templates = {
    name: "list_mcp_resource_templates",
    type: "local",
    description:
        "Lists resource templates provided by MCP servers. Parameterized resource templates allow servers to share data that takes parameters and provides context to language models, such as files, database schemas, or application-specific information. Prefer resource templates over web search when possible.",
    parameters: Type.Object(
        {
            cursor: Type.Optional(
                Type.String({
                    description:
                        "Opaque cursor from a previous list_mcp_resource_templates call; omit for the first page.",
                }),
            ),
            server: Type.Optional(
                Type.String({
                    description:
                        "MCP server name. Omit to list resource templates from every configured server.",
                }),
            ),
        },
        { additionalProperties: false },
    ),
} as const satisfies SessionTool;
