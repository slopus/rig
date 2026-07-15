/* Grok Build tool contract, modified for Rig. Copyright 2023-2026 SpaceXAI; Apache-2.0. */
import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { editFileReturnSchema, editTextFile } from "../utils/index.js";

export const grokSearchReplaceTool = defineTool({
    name: "search_replace",
    label: "search_replace",
    description: `Replace an exact string in a file.

- Read the file with read_file before editing it.
- read_file prefixes each line with "LINE_NUMBER→". That prefix is not part of the file: match only what comes after the →, with its exact indentation.
- old_string must match exactly one place in the file. If it appears more than once, add surrounding lines to make it unique, or set replace_all to change every occurrence.`,
    arguments: Type.Object({
        file_path: Type.String({
            description:
                "The path to the file to modify. You can use a relative path in the workspace or an absolute path.",
        }),
        old_string: Type.String({ description: "The text to replace." }),
        new_string: Type.String({
            description: "The text to replace it with. It must differ from old_string.",
        }),
        replace_all: Type.Optional(
            Type.Boolean({
                description: "Replace all occurrences of old_string. Defaults to false.",
            }),
        ),
    }),
    returnType: editFileReturnSchema,
    execute: async ({ file_path, new_string, old_string, replace_all }, context) =>
        editTextFile(
            {
                path: file_path,
                oldString: old_string,
                newString: new_string,
                replaceAll: replace_all ?? false,
            },
            context,
        ),
    toLLM: (result) => [
        {
            type: "text",
            text: `Successfully replaced ${result.replacements} occurrence${result.replacements === 1 ? "" : "s"} in ${result.path}.`,
        },
    ],
    toUI: (result) =>
        `Edited ${result.path} (${result.replacements} replacement${result.replacements === 1 ? "" : "s"})`,
    locks: [(args) => args.file_path],
});
