import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const scheduler_delete = {
    name: "scheduler_delete",
    type: "local",
    description:
        "Cancel a scheduled task by ID.\n\nReturns success: true if the task was found and removed, false if no task with that ID exists.",
    parameters: Type.Object(
        {
            id: Type.String({
                description: "The task ID to cancel (from scheduler_create output)",
            }),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "SchedulerDeleteInput",
        },
    ),
} as const satisfies SessionTool;
