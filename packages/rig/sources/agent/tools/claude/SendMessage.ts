import { Type } from "@sinclair/typebox";

import { defineTool } from "../../types.js";

export const claudeSendMessageTool = defineTool({
    name: "SendMessage",
    label: "SendMessage",
    description:
        "Send follow-up work to a previously spawned subagent by its task name, path, or agent id. The agent resumes with its full context preserved.",
    arguments: Type.Object({
        to: Type.String({ description: "The target subagent's task name, path, or agent id." }),
        summary: Type.Optional(
            Type.String({
                description: "A short human-readable summary of the follow-up.",
                maxLength: 200,
            }),
        ),
        message: Type.String({ description: "The follow-up instructions." }),
        effort: Type.Optional(
            Type.String({
                description:
                    "New effort level for the subagent. Must be one of its model's allowed effort levels shown in the system prompt.",
            }),
        ),
    }),
    returnType: Type.Object({
        message: Type.String(),
        success: Type.Boolean(),
        target: Type.String(),
    }),
    shouldReviewInAutoMode: () => false,
    execute: ({ effort, message, summary, to }, context) => {
        if (context.subagents === undefined) {
            throw new Error("Subagent management is unavailable in this session.");
        }
        const target = context.subagents.followUp(to, message, effort);
        return {
            message:
                summary === undefined
                    ? `Follow-up work was sent to ${target.description}.`
                    : `${summary}: follow-up work was sent to ${target.description}.`,
            success: true,
            target: target.path,
        };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) => result.message,
    locks: [],
});
