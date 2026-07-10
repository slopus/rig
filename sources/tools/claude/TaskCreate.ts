import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { taskMetadataSchema } from "./taskSchemas.js";

export const claudeTaskCreateTool = defineTool({
    name: "TaskCreate",
    label: "TaskCreate",
    description:
        "Create a structured task for a non-trivial coding session. New tasks begin as pending.",
    arguments: Type.Object(
        {
            subject: Type.String({ description: "A brief actionable title for the task." }),
            description: Type.String({ description: "What needs to be done." }),
            activeForm: Type.Optional(
                Type.String({ description: "Present-continuous text shown while in progress." }),
            ),
            metadata: Type.Optional(taskMetadataSchema),
        },
        { additionalProperties: false },
    ),
    returnType: Type.Object({
        task: Type.Object({ id: Type.String(), subject: Type.String() }),
    }),
    execute({ subject, description, activeForm, metadata }, context) {
        if (context.tasks === undefined) {
            throw new Error("Task tracking is unavailable in this session.");
        }
        const task = context.tasks.create({
            subject,
            description,
            ...(activeForm !== undefined ? { activeForm } : {}),
            ...(metadata !== undefined ? { metadata } : {}),
        });
        return { task: { id: task.id, subject: task.subject } };
    },
    toLLM: ({ task }) => [
        { type: "text", text: `Task #${task.id} created successfully: ${task.subject}` },
    ],
    toUI: ({ task }) => `Created task: ${task.subject}`,
    locks: ["tasks"],
});
