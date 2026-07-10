import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { managedSubagentSchema } from "./subagentSchemas.js";
import { requireSubagentContext } from "./requireSubagentContext.js";

export const codexFollowupTaskTool = defineTool({
    name: "followup_task",
    label: "followup_task",
    description:
        "Send follow-up work to an existing subagent. If it is idle, this starts another turn; if it is busy, the work is queued.",
    arguments: Type.Object({
        target: Type.String({ description: "Agent id, task name, or full task path." }),
        message: Type.String({ description: "The follow-up instructions." }),
    }),
    returnType: managedSubagentSchema,
    execute: ({ message, target }, context) =>
        requireSubagentContext(context).followUp(target, message),
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) => `Sent follow-up work to ${result.description}.`,
    locks: [],
});
