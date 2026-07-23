import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const claude_send_message_tool: SessionTool = {
    name: "SendMessage",
    type: "local",
    description:
        "Send follow-up work to a previously spawned subagent by its task name, path, or agent id. The agent resumes with its full context preserved.",
    parameters: Type.Object(
        {
            to: Type.String({ description: "Recipient: teammate name" }),
            summary: Type.Optional(
                Type.String({
                    description: "A short human-readable summary of the follow-up.",
                    maxLength: 200,
                }),
            ),
            message: Type.String({ description: "Plain text message content" }),
            effort: Type.Optional(
                Type.String({
                    description:
                        "New effort level for the subagent. Must be one of its model's allowed effort levels shown in the system prompt.",
                }),
            ),
        },
        { additionalProperties: false },
    ),
};

export const claude_send_message_tool_sonnet: SessionTool = {
    name: "SendMessage",
    type: "local",
    description:
        "Send follow-up work to a previously spawned subagent by its task name, path, or agent id. The agent resumes with its full context preserved.",
    parameters: Type.Object(
        {
            to: Type.String({ description: "Recipient: teammate name" }),
            summary: Type.Optional(
                Type.String({
                    description: "A short human-readable summary of the follow-up.",
                    maxLength: 200,
                }),
            ),
            message: Type.String({ description: "Plain text message content" }),
            effort: Type.Optional(
                Type.String({
                    description:
                        "New effort level for the subagent. Must be one of its model's allowed effort levels shown in the system prompt.",
                }),
            ),
        },
        { additionalProperties: false },
    ),
};
