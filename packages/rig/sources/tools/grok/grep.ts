/* Grok Build tool contract, modified for Rig. Copyright 2023-2026 SpaceXAI; Apache-2.0. */
import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { countTextLines, runRipgrep, textOutputSchema, toTextBlocks } from "../utils/index.js";

export const grokGrepTool = defineTool({
    name: "grep",
    label: "grep",
    description: `Search file contents with regular expressions (ripgrep).

- Use full regular-expression syntax and pass the pattern without surrounding quotes.
- Respects .gitignore.
- Only filter by type or glob when you are sure of the file type.
- Output is ripgrep-style and large results are capped.`,
    arguments: Type.Object({
        pattern: Type.String({
            description: "The regular expression pattern to search for in file contents.",
        }),
        path: Type.Optional(
            Type.String({
                description: "File or directory to search. Defaults to the workspace path.",
            }),
        ),
        glob: Type.Optional(
            Type.String({ description: "Glob pattern used to filter files, such as '*.ts'." }),
        ),
        "-B": Type.Optional(
            Type.Integer({ description: "Number of lines to show before each match.", minimum: 0 }),
        ),
        "-A": Type.Optional(
            Type.Integer({ description: "Number of lines to show after each match.", minimum: 0 }),
        ),
        "-C": Type.Optional(
            Type.Integer({
                description: "Number of lines to show before and after each match.",
                minimum: 0,
            }),
        ),
        "-i": Type.Optional(
            Type.Boolean({ description: "Case-insensitive search. Defaults to false." }),
        ),
        type: Type.Optional(
            Type.String({ description: "File type to search, such as js, py, rust, or go." }),
        ),
        head_limit: Type.Optional(
            Type.Integer({ description: "Limit output to the first N lines. Defaults to 200." }),
        ),
        multiline: Type.Optional(
            Type.Boolean({
                description:
                    "Enable multiline mode, where patterns can span lines. Defaults to false.",
            }),
        ),
    }),
    returnType: textOutputSchema,
    execute: async (args, context, execution) => {
        const result = await runRipgrep(
            {
                pattern: args.pattern,
                outputMode: "content",
                headLimit: args.head_limit ?? 200,
                ...(args.path === undefined ? {} : { path: args.path }),
                ...(args.glob === undefined ? {} : { glob: args.glob }),
                ...(args["-B"] === undefined ? {} : { before: args["-B"] }),
                ...(args["-A"] === undefined ? {} : { after: args["-A"] }),
                ...(args["-C"] === undefined ? {} : { context: args["-C"] }),
                ...(args["-i"] === undefined ? {} : { ignoreCase: args["-i"] }),
                ...(args.type === undefined ? {} : { type: args.type }),
                ...(args.multiline === undefined ? {} : { multiline: args.multiline }),
                ...(execution.signal === undefined ? {} : { signal: execution.signal }),
            },
            context,
        );
        return { text: result.text.length === 0 ? "No matches found" : result.text };
    },
    toLLM: toTextBlocks,
    toUI: (result, args) =>
        result.text === "No matches found"
            ? `Searched "${args.pattern}" (no matches)`
            : `Searched "${args.pattern}" (${countTextLines(result.text)} matches)`,
    locks: [],
});
