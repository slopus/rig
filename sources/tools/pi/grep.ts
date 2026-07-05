import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { countTextLines, runRipgrep, textOutputSchema, toTextBlocks } from "../utils/index.js";

const DEFAULT_LIMIT = 100;
const DEFAULT_MAX_BYTES = 50 * 1024;
const GREP_MAX_LINE_LENGTH = 500;

export const piGrepTool = defineTool({
  name: "grep",
  label: "grep",
  description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`,
  arguments: Type.Object({
    pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
    path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
    glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" })),
    ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
    literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" })),
    context: Type.Optional(Type.Number({ description: "Number of lines to show before and after each match (default: 0)" })),
    limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
  }),
  returnType: textOutputSchema,
  execute: async (args, context, execution) => {
    const grepOptions: Parameters<typeof runRipgrep>[0] = {
      pattern: args.pattern,
      outputMode: "content",
      headLimit: args.limit ?? DEFAULT_LIMIT,
    };
    if (args.path !== undefined) grepOptions.path = args.path;
    if (args.glob !== undefined) grepOptions.glob = args.glob;
    if (args.ignoreCase !== undefined) grepOptions.ignoreCase = args.ignoreCase;
    if (args.literal !== undefined) grepOptions.literal = args.literal;
    if (args.context !== undefined) grepOptions.context = args.context;
    if (execution.signal !== undefined) grepOptions.signal = execution.signal;
    const result = await runRipgrep(grepOptions, context);
    return { text: result.text.length > 0 ? result.text : "No matches found" };
  },
  toLLM: toTextBlocks,
  toUI: (result, args) =>
    result.text === "No matches found"
      ? `Searched "${args.pattern}" (no matches)`
      : `Searched "${args.pattern}" (${countTextLines(result.text)} matches)`,
  locks: [],
});
