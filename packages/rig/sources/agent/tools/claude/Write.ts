import { Type } from "@sinclair/typebox";

import { defineTool } from "../../types.js";
import { describeFileAutoPermissionAction } from "../../../permissions/describeFileAutoPermissionAction.js";
import { shouldReviewPathInAutoMode } from "../../../permissions/shouldReviewPathInAutoMode.js";
import { textOutputSchema, toTextBlocks, writeTextFile } from "../../../tools/utils/index.js";

const CLAUDE_WRITE_DESCRIPTION = `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files -- it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`;

export const claudeWriteTool = defineTool({
    name: "Write",
    label: "Write",
    description: CLAUDE_WRITE_DESCRIPTION,
    arguments: Type.Object({
        file_path: Type.String({
            description: "The absolute path to the file to write (must be absolute, not relative)",
        }),
        content: Type.String({ description: "The content to write to the file" }),
    }),
    returnType: textOutputSchema,
    describeAutoPermissionAction: ({ file_path }, context) =>
        describeFileAutoPermissionAction(file_path, context, "writing"),
    shouldReviewInAutoMode: ({ file_path }, context) =>
        shouldReviewPathInAutoMode(file_path, context, { write: true }),
    shouldRunInFullAccessInAutoMode: ({ file_path }, context) =>
        shouldReviewPathInAutoMode(file_path, context, { write: true }),
    execute: async ({ file_path, content }, context) => {
        const result = await writeTextFile({ path: file_path, content }, context);
        return {
            text: `File ${result.created ? "created" : "updated"} successfully at: ${result.path}`,
        };
    },
    toLLM: toTextBlocks,
    toUI: (_result, args) => `Wrote ${args.file_path}`,
    locks: [(args) => args.file_path],
});
