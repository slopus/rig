import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const exit_plan_mode = {
    name: "exit_plan_mode",
    type: "local",
    description:
        "Exit plan mode and present your plan to the user.\n\nUse this after you have finished writing your plan to the plan file in plan mode.",
    parameters: Type.Object(
        {},
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "ExitPlanModeInput",
            description:
                "Input for the `ExitPlanMode` tool.\n\nEmpty object — the plan is read from the plan file on disk, NOT passed as\na parameter. This ensures the user sees exactly what was written to disk,\npreventing divergence between the model's in-context plan and the actual\nfile content.",
            required: [],
        },
    ),
} as const satisfies SessionTool;
