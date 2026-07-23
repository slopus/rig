/* Grok Build tool contract, modified for Rig. Copyright 2023-2026 SpaceXAI; Apache-2.0. */
import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { humanizeTaskName } from "../../agent/tools/codex/impl/humanizeTaskName.js";
import { requireSubagentContext } from "../../agent/tools/codex/impl/requireSubagentContext.js";

export const grokFollowupSubagentTool = defineTool({
    name: "followup_subagent",
    label: "followup_subagent",
    description:
        "Send follow-up work to a retained subagent and trigger another turn with its full context preserved.",
    arguments: Type.Object({
        target: Type.String({ description: "Subagent id, task name, or full task path." }),
        prompt: Type.String({ description: "The follow-up instructions." }),
        effort: Type.Optional(
            Type.String({
                description:
                    "New effort level for the subagent. Must be one of its model's allowed effort levels shown in the system prompt.",
            }),
        ),
    }),
    returnType: Type.Object({
        subagent_id: Type.String(),
        task_name: Type.String(),
        status: Type.String(),
    }),
    shouldReviewInAutoMode: () => false,
    execute: ({ effort, prompt, target }, context) => {
        const subagent = requireSubagentContext(context).followUp(target, prompt, effort);
        return {
            status: subagent.status,
            subagent_id: subagent.sessionId,
            task_name: subagent.taskName,
        };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) => `Sent follow-up work to ${humanizeTaskName(result.task_name)}.`,
    locks: [],
});
