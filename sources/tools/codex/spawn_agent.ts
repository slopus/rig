import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { humanizeTaskName } from "./humanizeTaskName.js";
import { requireSubagentContext } from "./requireSubagentContext.js";

export const codexSpawnAgentTool = defineTool({
    name: "spawn_agent",
    label: "spawn_agent",
    description:
        "Spawn a background subagent for a concrete, bounded task. The new agent shares the workspace and reports back when it finishes.",
    arguments: Type.Object({
        task_name: Type.String({
            description: "Lowercase task name using letters, numbers, and underscores.",
        }),
        message: Type.String({ description: "Complete instructions for the new agent." }),
    }),
    returnType: Type.Object({
        agent_id: Type.String(),
        path: Type.String(),
        task_name: Type.String(),
    }),
    execute: async ({ message, task_name }, context, execution) => {
        const result = await requireSubagentContext(context).spawn({
            background: true,
            description: humanizeTaskName(task_name),
            ...(execution.toolCallId === undefined
                ? {}
                : { parentToolCallId: execution.toolCallId }),
            prompt: message,
            taskName: task_name,
        });
        return { agent_id: result.sessionId, path: result.path, task_name: result.taskName };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) => `Started background task ${humanizeTaskName(result.task_name)}.`,
    locks: [],
});
