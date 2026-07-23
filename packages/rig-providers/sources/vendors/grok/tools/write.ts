import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const write = {
    name: "write",
    type: "local",
    description:
        "Create or overwrite a file.\n\n- Writing to an existing path replaces the file — read it first with the read_file tool.\n- Parent directories are created for you.",
    parameters: Type.Object(
        {
            file_path: Type.String({
                description: "The absolute path to the file to write.",
            }),
            content: Type.String({
                description: "The full file content to write.",
            }),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "WriteInput",
            description: "Input for the `write` tool.",
        },
    ),
} as const satisfies SessionTool;
