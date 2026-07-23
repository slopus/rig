import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const list_dir = {
    name: "list_dir",
    type: "local",
    description:
        "Lists files and directories in a given path.\nThe 'target_directory' parameter can be relative to the workspace root or absolute.\n\nOther details:\n    - The result does not display dot-files and dot-directories.\n    - Respects .gitignore patterns (files/directories ignored by git are not shown).\n    - Large directories are summarized with file counts and extension breakdowns instead of listing all files.",
    parameters: Type.Object(
        {
            target_directory: Type.String({
                description:
                    "Path to directory to list contents of, relative to the workspace root or absolute.",
            }),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "ListDirInput",
        },
    ),
} as const satisfies SessionTool;
