import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const claude_write_tool: SessionTool = {
    name: "Write",
    type: "local",
    description:
        "Writes a file to the local filesystem, overwriting if one exists.\n\nWhen to use: creating a new file, or fully replacing one you've already Read. Overwriting an existing file you haven't Read will fail. For partial changes, use Edit instead.",
    parameters: Type.Object(
        {
            file_path: Type.String({
                description:
                    "The absolute path to the file to write (must be absolute, not relative)",
            }),
            content: Type.String({ description: "The content to write to the file" }),
        },
        { additionalProperties: false },
    ),
};

export const claude_write_tool_sonnet: SessionTool = {
    name: "Write",
    type: "local",
    description:
        "Writes a file to the local filesystem.\n\nUsage:\n- This tool will overwrite the existing file if there is one at the provided path.\n- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.\n- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.\n- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.\n- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.",
    parameters: Type.Object(
        {
            file_path: Type.String({
                description:
                    "The absolute path to the file to write (must be absolute, not relative)",
            }),
            content: Type.String({ description: "The content to write to the file" }),
        },
        { additionalProperties: false },
    ),
};
