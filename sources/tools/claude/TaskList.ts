import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { taskStatusSchema } from "./taskSchemas.js";

const taskSummarySchema = Type.Object({
    id: Type.String(),
    subject: Type.String(),
    status: taskStatusSchema,
    owner: Type.Optional(Type.String()),
    blockedBy: Type.Array(Type.String()),
});

export const claudeTaskListTool = defineTool({
    name: "TaskList",
    label: "TaskList",
    description: "List all tasks with their status, owner, and unresolved dependencies.",
    arguments: Type.Object({}, { additionalProperties: false }),
    returnType: Type.Object({ tasks: Type.Array(taskSummarySchema) }),
    execute(_args, context) {
        if (context.tasks === undefined) {
            throw new Error("Task tracking is unavailable in this session.");
        }
        const tasks = context.tasks.list();
        const completed = new Set(
            tasks.filter((task) => task.status === "completed").map((task) => task.id),
        );
        return {
            tasks: tasks.map((task) => ({
                id: task.id,
                subject: task.subject,
                status: task.status,
                ...(task.owner !== undefined ? { owner: task.owner } : {}),
                blockedBy: task.blockedBy.filter((taskId) => !completed.has(taskId)),
            })),
        };
    },
    toLLM: ({ tasks }) => [
        {
            type: "text",
            text:
                tasks.length === 0
                    ? "No tasks found"
                    : tasks
                          .map((task) => {
                              const owner = task.owner === undefined ? "" : ` (${task.owner})`;
                              const blocked =
                                  task.blockedBy.length === 0
                                      ? ""
                                      : ` [blocked by ${task.blockedBy.join(", ")}]`;
                              return `#${task.id} [${task.status}] ${task.subject}${owner}${blocked}`;
                          })
                          .join("\n"),
        },
    ],
    toUI: ({ tasks }) => `Listed ${tasks.length} task${tasks.length === 1 ? "" : "s"}`,
    locks: [],
});
