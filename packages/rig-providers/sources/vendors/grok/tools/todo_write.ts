import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const todo_write = {
    name: "todo_write",
    type: "local",
    description:
        "Create and manage a structured task list. The user sees this list live — it is your primary way to show progress.\n\nUse for any task with 3+ steps. Skip for trivial single-step work.",
    parameters: Type.Object(
        {
            merge: Type.Optional(
                Type.Boolean({
                    description:
                        "Optional. When true (default), merges the provided todos into the existing list by id — send only the items you are changing, and to flip status without changing content send just id + status. When false, the provided todos replace the existing list.",
                    default: true,
                }),
            ),
            todos: Type.Array(
                Type.Object({
                    id: Type.String({
                        description: "Unique identifier for the todo item",
                    }),
                    content: Type.Optional(
                        Type.Unsafe({
                            description: "The description/content of the todo item",
                            type: ["string", "null"],
                        }),
                    ),
                    status: Type.Optional(
                        Type.Unsafe({
                            description:
                                "The status of the todo item: pending, in_progress, completed, or cancelled",
                            type: ["string", "null"],
                            enum: ["pending", "in_progress", "completed", "cancelled", null],
                        }),
                    ),
                }),
                {
                    description: "Array of todo items to write to the workspace",
                },
            ),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "TodoWriteInput",
        },
    ),
} as const satisfies SessionTool;
