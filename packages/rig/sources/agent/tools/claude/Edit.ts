import { Type } from "@sinclair/typebox";

import { defineTool } from "../../types.js";
import { describeFileAutoPermissionAction } from "../../../permissions/describeFileAutoPermissionAction.js";
import { shouldReviewPathInAutoMode } from "../../../permissions/shouldReviewPathInAutoMode.js";
import { editFileReturnSchema, editTextFile } from "../../../tools/utils/index.js";

const CLAUDE_EDIT_DESCRIPTION = `Performs exact string replacements in files.

Usage:
- You must use your \`Read\` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + arrow. Everything after that is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if \`old_string\` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use \`replace_all\` to change every instance of \`old_string\`.
- Use \`replace_all\` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`;

export const claudeEditTool = defineTool({
    name: "Edit",
    label: "Edit",
    description: CLAUDE_EDIT_DESCRIPTION,
    arguments: Type.Object({
        file_path: Type.String({ description: "The absolute path to the file to modify" }),
        old_string: Type.String({ description: "The text to replace" }),
        new_string: Type.String({
            description: "The text to replace it with (must be different from old_string)",
        }),
        replace_all: Type.Optional(
            Type.Boolean({ description: "Replace all occurrences of old_string (default false)" }),
        ),
    }),
    returnType: editFileReturnSchema,
    describeAutoPermissionAction: ({ file_path }, context) =>
        describeFileAutoPermissionAction(file_path, context, "editing"),
    shouldReviewInAutoMode: ({ file_path }, context) =>
        shouldReviewPathInAutoMode(file_path, context, { write: true }),
    shouldRunInFullAccessInAutoMode: ({ file_path }, context) =>
        shouldReviewPathInAutoMode(file_path, context, { write: true }),
    execute: async ({ file_path, old_string, new_string, replace_all }, context) => {
        const result = await editTextFile(
            {
                path: file_path,
                oldString: old_string,
                newString: new_string,
                replaceAll: replace_all ?? false,
                fuzzy: false,
            },
            context,
        );
        return result;
    },
    toLLM: (result) => [
        {
            type: "text",
            text: `The file ${result.path} has been updated.`,
        },
    ],
    toUI: (result) =>
        `Edited ${result.path} (${result.replacements} replacement${result.replacements === 1 ? "" : "s"})`,
    locks: [(args) => args.file_path],
});
