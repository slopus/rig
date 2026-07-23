import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const claude_glob_tool: SessionTool = {
    name: "Glob",
    type: "local",
    description:
        '- Fast file pattern matching tool that works with any codebase size\n- Supports glob patterns like "**/*.js" or "src/**/*.ts"\n- Returns matching file paths sorted by modification time\n- Use this tool when you need to find files by name patterns\n- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead',
    parameters: Type.Object({
        pattern: Type.String({ description: "The glob pattern to match files against" }),
        path: Type.Optional(
            Type.String({
                description:
                    'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.',
            }),
        ),
    }),
};

export const claude_glob_tool_sonnet: SessionTool = {
    name: "Glob",
    type: "local",
    description:
        '- Fast file pattern matching tool that works with any codebase size\n- Supports glob patterns like "**/*.js" or "src/**/*.ts"\n- Returns matching file paths sorted by modification time\n- Use this tool when you need to find files by name patterns\n- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead',
    parameters: Type.Object({
        pattern: Type.String({ description: "The glob pattern to match files against" }),
        path: Type.Optional(
            Type.String({
                description:
                    'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.',
            }),
        ),
    }),
};
