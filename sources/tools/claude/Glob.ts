import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { countTextLines, globFiles, textOutputSchema, toTextBlocks } from "../utils/index.js";

const CLAUDE_GLOB_DESCRIPTION = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead`;

export const claudeGlobTool = defineTool({
  name: "Glob",
  label: "Glob",
  description: CLAUDE_GLOB_DESCRIPTION,
  arguments: Type.Object({
    pattern: Type.String({ description: "The glob pattern to match files against" }),
    path: Type.Optional(
      Type.String({
        description:
          'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.',
      }),
    ),
  }),
  returnType: textOutputSchema,
  execute: async ({ pattern, path }, context, execution) => {
    const options: Parameters<typeof globFiles>[0] = { pattern, limit: 100 };
    if (path !== undefined) options.path = path;
    if (execution.signal !== undefined) options.signal = execution.signal;
    const files = await globFiles(options, context);
    return {
      text: files.length > 0 ? files.join("\n") : "No files found",
    };
  },
  toLLM: toTextBlocks,
  toUI: (result, args) =>
    result.text === "No files found"
      ? `Found files for "${args.pattern}" (0)`
      : `Found files for "${args.pattern}" (${countTextLines(result.text)})`,
  locks: [],
});
