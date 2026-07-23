import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const scheduler_list = {
    name: "scheduler_list",
    type: "local",
    description:
        "List all active scheduled tasks with their IDs, prompts, intervals, and next fire times.",
    parameters: Type.Object(
        {},
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "SchedulerListInput",
            required: [],
        },
    ),
} as const satisfies SessionTool;
