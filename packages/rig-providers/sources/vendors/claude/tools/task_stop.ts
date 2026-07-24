import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const claude_task_stop_tool: SessionTool = {
    name: "TaskStop",
    type: "local",
    description: "Stop a running background shell task, agent, or workflow by its identifier.",
    parameters: Type.Object(
        {
            task_id: Type.String({ description: "The background task identifier." }),
        },
        { additionalProperties: false },
    ),
};

export const claude_task_stop_tool_sonnet: SessionTool = {
    name: "TaskStop",
    type: "local",
    description: "Stop a running background shell task, agent, or workflow by its identifier.",
    parameters: Type.Object(
        {
            task_id: Type.String({ description: "The background task identifier." }),
        },
        { additionalProperties: false },
    ),
};
