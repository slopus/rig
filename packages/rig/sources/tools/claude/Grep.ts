import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { describeFileAutoPermissionAction } from "../../permissions/describeFileAutoPermissionAction.js";
import { shouldReviewPathInAutoMode } from "../../permissions/shouldReviewPathInAutoMode.js";
import {
    boundGrepOutput,
    formatOutputLineCount,
    GREP_OUTPUT_DEFAULT_LIMIT,
    GREP_OUTPUT_MAX_BYTES,
    GREP_OUTPUT_MAX_LINE_LENGTH,
    runRipgrep,
    textOutputSchema,
    toTextBlocks,
} from "../utils/index.js";

const CLAUDE_GREP_DESCRIPTION = `A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use Grep for search tasks. NEVER invoke \`grep\` or \`rg\` as a Bash command. The Grep tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use Agent tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use \`interface\\{\\}\` to find \`interface{}\` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like \`struct \\{[\\s\\S]*?field\`, use \`multiline: true\`
  - Output is capped at ${GREP_OUTPUT_DEFAULT_LIMIT} entries by default or ${GREP_OUTPUT_MAX_BYTES / 1024}KB, and lines are capped at ${GREP_OUTPUT_MAX_LINE_LENGTH} characters
`;

export const claudeGrepTool = defineTool({
    name: "Grep",
    label: "Grep",
    description: CLAUDE_GREP_DESCRIPTION,
    arguments: Type.Object({
        pattern: Type.String({
            description: "The regular expression pattern to search for in file contents",
        }),
        path: Type.Optional(
            Type.String({
                description:
                    "File or directory to search in (rg PATH). Defaults to current working directory.",
            }),
        ),
        glob: Type.Optional(
            Type.String({
                description:
                    'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob',
            }),
        ),
        output_mode: Type.Optional(
            Type.Union(
                [
                    Type.Literal("content"),
                    Type.Literal("files_with_matches"),
                    Type.Literal("count"),
                ],
                {
                    description:
                        'Output mode: "content" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), "files_with_matches" shows file paths (supports head_limit), "count" shows match counts (supports head_limit). Defaults to "files_with_matches".',
                },
            ),
        ),
        "-B": Type.Optional(
            Type.Number({
                description:
                    'Number of lines to show before each match (rg -B). Requires output_mode: "content", ignored otherwise.',
            }),
        ),
        "-A": Type.Optional(
            Type.Number({
                description:
                    'Number of lines to show after each match (rg -A). Requires output_mode: "content", ignored otherwise.',
            }),
        ),
        "-C": Type.Optional(Type.Number({ description: "Alias for context." })),
        context: Type.Optional(
            Type.Number({
                description:
                    'Number of lines to show before and after each match (rg -C). Requires output_mode: "content", ignored otherwise.',
            }),
        ),
        "-n": Type.Optional(
            Type.Boolean({
                description:
                    'Show line numbers in output (rg -n). Requires output_mode: "content", ignored otherwise. Defaults to true.',
            }),
        ),
        "-i": Type.Optional(Type.Boolean({ description: "Case insensitive search (rg -i)" })),
        type: Type.Optional(
            Type.String({
                description:
                    "File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types.",
            }),
        ),
        head_limit: Type.Optional(
            Type.Number({
                description: `Limit output to first N lines/entries, equivalent to "| head -N". Works across all output modes: content (limits output lines), files_with_matches (limits file paths), count (limits count entries). Defaults to ${GREP_OUTPUT_DEFAULT_LIMIT} when unspecified. Pass 0 to remove the entry limit; the byte and line-length limits still apply.`,
            }),
        ),
        offset: Type.Optional(
            Type.Number({
                description:
                    'Skip first N lines/entries before applying head_limit, equivalent to "| tail -n +N | head -N". Works across all output modes. Defaults to 0.',
            }),
        ),
        multiline: Type.Optional(
            Type.Boolean({
                description:
                    "Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false.",
            }),
        ),
    }),
    returnType: textOutputSchema,
    describeAutoPermissionAction: ({ path }, context) =>
        describeFileAutoPermissionAction(path ?? ".", context, "searching"),
    shouldReviewInAutoMode: ({ path }, context) =>
        shouldReviewPathInAutoMode(path ?? ".", context, { write: false }),
    shouldRunInFullAccessInAutoMode: ({ path }, context) =>
        shouldReviewPathInAutoMode(path ?? ".", context, { write: false }),
    execute: async (args, context, execution) => {
        const options: Parameters<typeof runRipgrep>[0] = {
            pattern: args.pattern,
            outputMode: args.output_mode ?? "files_with_matches",
            lineNumbers: args["-n"] ?? true,
        };
        const contextLines = args.context ?? args["-C"];
        if (contextLines !== undefined) options.context = contextLines;
        if (args.path !== undefined) options.path = args.path;
        if (args.glob !== undefined) options.glob = args.glob;
        if (args["-B"] !== undefined) options.before = args["-B"];
        if (args["-A"] !== undefined) options.after = args["-A"];
        if (args["-i"] !== undefined) options.ignoreCase = args["-i"];
        if (args.type !== undefined) options.type = args.type;
        options.headLimit = args.head_limit ?? GREP_OUTPUT_DEFAULT_LIMIT;
        if (args.offset !== undefined) options.offset = args.offset;
        if (args.multiline !== undefined) options.multiline = args.multiline;
        if (execution.signal !== undefined) options.signal = execution.signal;
        const result = await runRipgrep(options, context);
        return {
            text: result.text.length > 0 ? boundGrepOutput(result.text) : "No matches found",
        };
    },
    toLLM: toTextBlocks,
    toUI: (result, args) =>
        result.text === "No matches found"
            ? `Searched "${args.pattern}" (no matches)`
            : `Searched "${args.pattern}" (${formatOutputLineCount(result.text)})`,
    locks: [],
});
