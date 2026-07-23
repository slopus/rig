import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const enter_plan_mode = {
    name: "enter_plan_mode",
    type: "local",
    description:
        "Use this tool when a task has ambiguity about the right approach or when the user asks you to write a plan. This tool enables a read-only plan mode where you explore the codebase and create an implementation plan for the user.",
    parameters: Type.Object(
        {},
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "EnterPlanModeInput",
            description:
                "Input for the `EnterPlanMode` tool.\n\nEmpty object — no parameters. The decision to enter plan mode is a binary\ngate. All configuration (workflow variant, explore agent count, etc.) comes\nfrom feature flags and environment variables, not from the tool call.",
            required: [],
        },
    ),
} as const satisfies SessionTool;
