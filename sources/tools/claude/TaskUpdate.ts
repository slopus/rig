import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { taskMetadataSchema, taskStatusSchema } from "./taskSchemas.js";

export const claudeTaskUpdateTool = defineTool({
    name: "TaskUpdate",
    label: "TaskUpdate",
    description:
        "Update a task's status, details, owner, or dependencies. Use deleted to remove a task.",
    arguments: Type.Object(
        {
            taskId: Type.String({ description: "The ID of the task to update." }),
            subject: Type.Optional(Type.String()),
            description: Type.Optional(Type.String()),
            activeForm: Type.Optional(Type.String()),
            status: Type.Optional(Type.Union([taskStatusSchema, Type.Literal("deleted")])),
            addBlocks: Type.Optional(Type.Array(Type.String())),
            addBlockedBy: Type.Optional(Type.Array(Type.String())),
            owner: Type.Optional(Type.String()),
            metadata: Type.Optional(taskMetadataSchema),
        },
        { additionalProperties: false },
    ),
    returnType: Type.Object({
        success: Type.Boolean(),
        taskId: Type.String(),
        updatedFields: Type.Array(Type.String()),
        error: Type.Optional(Type.String()),
        statusChange: Type.Optional(
            Type.Object({
                from: taskStatusSchema,
                to: Type.Union([taskStatusSchema, Type.Literal("deleted")]),
            }),
        ),
    }),
    execute({ taskId, ...request }, context) {
        if (context.tasks === undefined) {
            throw new Error("Task tracking is unavailable in this session.");
        }
        const result = context.tasks.update(taskId, request);
        const response: {
            error?: string;
            statusChange?: {
                from: "completed" | "in_progress" | "pending";
                to: "completed" | "deleted" | "in_progress" | "pending";
            };
            success: boolean;
            taskId: string;
            updatedFields: string[];
        } = {
            success: result.success,
            taskId: result.taskId,
            updatedFields: [...result.updatedFields],
        };
        if (result.error !== undefined) response.error = result.error;
        if (result.statusChange !== undefined) response.statusChange = { ...result.statusChange };
        return response;
    },
    toLLM: (result) => [
        {
            type: "text",
            text: result.success
                ? `Task #${result.taskId} updated successfully: ${result.updatedFields.join(", ") || "no changes"}`
                : `Task #${result.taskId} could not be updated: ${result.error ?? "unknown error"}`,
        },
    ],
    toUI: (result) =>
        result.success ? `Updated task ${result.taskId}` : `Task ${result.taskId} was not updated`,
    locks: ["tasks"],
});
