import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const claude_task_output_tool: SessionTool = {
    name: "TaskOutput",
    type: "local",
    description:
        "Read output from a running or completed background shell task, agent, or workflow.",
    parameters: Type.Object({
        task_id: Type.String({ description: "The background task identifier." }),
        block: Type.Optional(
            Type.Boolean({
                default: true,
                description: "Whether to wait for the task to finish.",
            }),
        ),
        timeout: Type.Optional(
            Type.Number({
                description: "Maximum wait in milliseconds.",
                default: 30000,
                minimum: 0,
                maximum: 600000,
            }),
        ),
    }),
};

export const claude_task_output_tool_sonnet: SessionTool = {
    name: "TaskOutput",
    type: "local",
    description:
        "Read output from a running or completed background shell task, agent, or workflow.",
    parameters: Type.Object({
        task_id: Type.String({ description: "The background task identifier." }),
        block: Type.Optional(
            Type.Boolean({
                default: true,
                description: "Whether to wait for the task to finish.",
            }),
        ),
        timeout: Type.Optional(
            Type.Number({
                description: "Maximum wait in milliseconds.",
                default: 30000,
                minimum: 0,
                maximum: 600000,
            }),
        ),
    }),
};
