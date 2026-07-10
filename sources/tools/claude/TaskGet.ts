import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { sessionTaskSchema } from "./taskSchemas.js";

export const claudeTaskGetTool = defineTool({
    name: "TaskGet",
    label: "TaskGet",
    description: "Get the full details and dependencies for a task by its ID.",
    arguments: Type.Object(
        { taskId: Type.String({ description: "The ID of the task to retrieve." }) },
        { additionalProperties: false },
    ),
    returnType: Type.Object({ task: Type.Union([sessionTaskSchema, Type.Null()]) }),
    execute({ taskId }, context) {
        if (context.tasks === undefined) {
            throw new Error("Task tracking is unavailable in this session.");
        }
        const task = context.tasks.get(taskId);
        return {
            task:
                task === undefined
                    ? null
                    : {
                          ...task,
                          blockedBy: [...task.blockedBy],
                          blocks: [...task.blocks],
                          ...(task.metadata !== undefined
                              ? { metadata: { ...task.metadata } }
                              : {}),
                      },
        };
    },
    toLLM: ({ task }) => {
        if (task === null) return [{ type: "text", text: "Task not found" }];
        const lines = [
            `Task #${task.id}: ${task.subject}`,
            `Status: ${task.status}`,
            `Description: ${task.description}`,
        ];
        if (task.blockedBy.length > 0) lines.push(`Blocked by: ${task.blockedBy.join(", ")}`);
        if (task.blocks.length > 0) lines.push(`Blocks: ${task.blocks.join(", ")}`);
        return [{ type: "text", text: lines.join("\n") }];
    },
    toUI: ({ task }, { taskId }) =>
        task === null ? `Task ${taskId} was not found` : `Read task: ${task.subject}`,
    locks: [],
});
