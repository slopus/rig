import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const claude_grep_tool: SessionTool = {
    name: "Grep",
    type: "local",
    description:
        'A powerful search tool built on ripgrep\n\n  Usage:\n  - ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command. The Grep tool has been optimized for correct permissions and access.\n  - Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")\n  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")\n  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts\n  - Use Agent tool for open-ended searches requiring multiple rounds\n  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use `interface\\{\\}` to find `interface{}` in Go code)\n  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like `struct \\{[\\s\\S]*?field`, use `multiline: true`\n  - Output is capped at 100 entries by default or 50KB, and lines are capped at 500 characters\n',
    parameters: Type.Object({
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
                description:
                    'Limit output to first N lines/entries, equivalent to "| head -N". Works across all output modes: content (limits output lines), files_with_matches (limits file paths), count (limits count entries). Defaults to 100 when unspecified. Pass 0 to remove the entry limit; the byte and line-length limits still apply.',
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
};

export const claude_grep_tool_sonnet: SessionTool = {
    name: "Grep",
    type: "local",
    description:
        'A powerful search tool built on ripgrep\n\n  Usage:\n  - ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command. The Grep tool has been optimized for correct permissions and access.\n  - Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")\n  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")\n  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts\n  - Use Agent tool for open-ended searches requiring multiple rounds\n  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use `interface\\{\\}` to find `interface{}` in Go code)\n  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like `struct \\{[\\s\\S]*?field`, use `multiline: true`\n  - Output is capped at 100 entries by default or 50KB, and lines are capped at 500 characters\n',
    parameters: Type.Object({
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
                description:
                    'Limit output to first N lines/entries, equivalent to "| head -N". Works across all output modes: content (limits output lines), files_with_matches (limits file paths), count (limits count entries). Defaults to 100 when unspecified. Pass 0 to remove the entry limit; the byte and line-length limits still apply.',
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
};
