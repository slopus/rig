import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const grep = {
    name: "grep",
    type: "local",
    description:
        "Search file contents with regular expressions (ripgrep).\n\n- Full regex syntax, so escape literal special characters: `functionCall\\(`, or `interface\\{\\}` to find interface{} in Go.\n- Pass pattern as a raw regex string — no surrounding quotes.\n- Respects .gitignore unless you pass a broad glob like '--glob *'.\n- Only filter by 'type' or 'glob' when you are sure of the file type; import paths may not match source file types (.js vs .ts).\n- Output is ripgrep-style: ':' marks match lines, '-' marks context lines, grouped by file. Large results are capped and report \"at least\" counts.",
    parameters: Type.Object(
        {
            pattern: Type.String({
                description:
                    "The regular expression pattern to search for in file contents (rg --regexp)",
            }),
            path: Type.Optional(
                Type.Unsafe({
                    description:
                        "File or directory to search in (rg pattern -- PATH). Defaults to workspace path.",
                    type: ["string", "null"],
                }),
            ),
            glob: Type.Optional(
                Type.Unsafe({
                    description:
                        'Glob pattern (rg --glob GLOB -- PATH) to filter files (e.g. "*.js", "*.{ts,tsx}").',
                    type: ["string", "null"],
                }),
            ),
            "-B": Type.Optional(
                Type.Integer({
                    description: "Number of lines to show before each match (rg -B).",
                }),
            ),
            "-A": Type.Optional(
                Type.Integer({
                    description: "Number of lines to show after each match (rg -A).",
                }),
            ),
            "-C": Type.Optional(
                Type.Integer({
                    description: "Number of lines to show before and after each match (rg -C).",
                }),
            ),
            "-i": Type.Optional(
                Type.Boolean({
                    description: "Case insensitive search (rg -i).",
                    default: false,
                }),
            ),
            type: Type.Optional(
                Type.Unsafe({
                    description:
                        "File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than glob for standard file types.",
                    type: ["string", "null"],
                }),
            ),
            head_limit: Type.Optional(
                Type.Integer({
                    description:
                        'Limit output to first N lines/entries, equivalent to "| head -N". Defaults to 200 lines or 500 entries.',
                }),
            ),
            multiline: Type.Optional(
                Type.Boolean({
                    description:
                        "Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall).",
                    default: false,
                }),
            ),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "GrepSearchInput",
        },
    ),
} as const satisfies SessionTool;
