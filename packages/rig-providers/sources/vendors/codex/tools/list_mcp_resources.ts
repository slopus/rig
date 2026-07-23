import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const list_mcp_resources = {
    name: "list_mcp_resources",
    type: "local",
    description:
        "Lists resources provided by MCP servers. Resources allow servers to share data that provides context to language models, such as files, database schemas, or application-specific information. Prefer resources over web search when possible.",
    parameters: Type.Object(
        {
            cursor: Type.Optional(
                Type.String({
                    description:
                        "Opaque cursor from a previous list_mcp_resources call; omit for the first page.",
                }),
            ),
            server: Type.Optional(
                Type.String({
                    description:
                        "MCP server name. Omit to list resources from every configured server.",
                }),
            ),
        },
        { additionalProperties: false },
    ),
} as const satisfies SessionTool;
