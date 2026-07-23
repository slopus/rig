import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const use_tool = {
    name: "use_tool",
    type: "local",
    description:
        "Call an MCP integration tool.\n\nThe `tool_name` must be the qualified `server__tool` name (e.g., `linear__save_issue`). The `tool_input` must conform exactly to the input schema returned by `search_tool`.",
    parameters: Type.Object(
        {
            tool_name: Type.String({
                description:
                    'The qualified name of the integration tool to call (e.g., "linear__save_issue").\nMust be a tool previously discovered via `search_tool`.',
            }),
            tool_input: Type.Unsafe({
                description:
                    "The arguments to pass to the tool, as a JSON object.\nUse the parameter schema returned by `search_tool` to construct this.",
                type: "object",
                additionalProperties: true,
            }),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "UseToolInput",
            description: "Input for the `use_tool` meta-dispatch tool.",
        },
    ),
} as const satisfies SessionTool;
