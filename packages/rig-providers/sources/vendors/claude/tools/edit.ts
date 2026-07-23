import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const claude_edit_tool: SessionTool = {
    name: "Edit",
    type: "local",
    description:
        "Performs exact string replacement in a file.\n\n- You must Read the file in this conversation before editing, or the call will fail.\n- `old_string` must match the file exactly, including indentation, and be unique — the edit fails otherwise. Strip the Read line prefix (line number + tab) before matching.\n- `replace_all: true` replaces every occurrence instead.",
    parameters: Type.Object(
        {
            file_path: Type.String({ description: "The absolute path to the file to modify" }),
            old_string: Type.String({ description: "The text to replace" }),
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
        { additionalProperties: false },
    ),
};

export const claude_edit_tool_sonnet: SessionTool = {
    name: "Edit",
    type: "local",
    description:
        "Performs exact string replacements in files.\n\nUsage:\n- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.\n- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + tab. Everything after that is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.\n- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.\n- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.\n- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.",
    parameters: Type.Object(
        {
            file_path: Type.String({ description: "The absolute path to the file to modify" }),
            old_string: Type.String({ description: "The text to replace" }),
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
        { additionalProperties: false },
    ),
};
