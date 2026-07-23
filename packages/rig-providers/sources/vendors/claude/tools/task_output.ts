import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const claude_task_output_tool: SessionTool = {
    name: "TaskOutput",
    type: "local",
    description: "Read output from a running or completed background shell task or workflow.",
    parameters: Type.Object(
        {
            task_id: Type.String({ description: "The task ID to get output from" }),
            block: Type.Boolean({ description: "Whether to wait for completion", default: true }),
            timeout: Type.Number({
                description: "Max wait time in ms",
                default: 30000,
                minimum: 0,
                maximum: 600000,
            }),
        },
        { additionalProperties: false },
    ),
};

export const claude_task_output_tool_sonnet: SessionTool = {
    name: "TaskOutput",
    type: "local",
    description: "Read output from a running or completed background shell task or workflow.",
    parameters: Type.Object(
        {
            task_id: Type.String({ description: "The task ID to get output from" }),
            block: Type.Boolean({ description: "Whether to wait for completion", default: true }),
            timeout: Type.Number({
                description: "Max wait time in ms",
                default: 30000,
                minimum: 0,
                maximum: 600000,
            }),
        },
        { additionalProperties: false },
    ),
};
