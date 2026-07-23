import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const update_plan = {
    name: "update_plan",
    type: "local",
    description:
        "Updates the task plan.\nProvide an optional explanation and a list of plan items, each with a step and status.\nAt most one step can be in_progress at a time.\n",
    parameters: Type.Object(
        {
            plan: Type.Array(
                Type.Object(
                    {
                        step: Type.String({ description: "Task step text." }),
                        status: Type.String({
                            description: "Step status.",
                            enum: ["pending", "in_progress", "completed"],
                        }),
                    },
                    { additionalProperties: false },
                ),
                { description: "The list of steps" },
            ),
            explanation: Type.Optional(
                Type.String({ description: "Optional explanation for this plan update." }),
            ),
        },
        { additionalProperties: false },
    ),
} as const satisfies SessionTool;
