import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const search_replace = {
    name: "search_replace",
    type: "local",
    description:
        'Replace an exact string in a file.\n\n- Read the file with `read_file` before editing it.\n- `read_file` prefixes each line with "LINE_NUMBER→". That prefix is not part of the file: match only what comes after the →, with its exact indentation.\n- `old_string` must match exactly one place in the file. If it appears more than once, add surrounding lines to make it unique, or set `replace_all` to change every occurrence (handy for renaming an identifier).',
    parameters: Type.Object(
        {
            file_path: Type.String({
                description:
                    "The path to the file to modify. You can use either a relative path in the workspace or an absolute path.",
            }),
            old_string: Type.String({
                description: "The text to replace",
            }),
            new_string: Type.String({
                description: "The text to replace it with (must be different from old_string)",
            }),
            replace_all: Type.Optional(
                Type.Boolean({
                    description: "Replace all occurrences of old_string (default false)",
                    default: false,
                }),
            ),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "SearchReplaceInput",
            description: "Input for the search_replace tool.",
        },
    ),
} as const satisfies SessionTool;
