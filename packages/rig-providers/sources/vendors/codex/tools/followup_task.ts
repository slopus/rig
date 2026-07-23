import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const followup_task = {
    name: "followup_task",
    namespace: "collaboration",
    type: "local",
    description:
        "Send a follow-up task to an existing non-root target agent and trigger a turn if it is idle. If the target is already running, deliver the task promptly at message boundaries while sampling, or after the pending tool call completes.",
    parameters: Type.Object(
        {
            target: Type.String({
                description:
                    "Agent id or canonical task name to send a follow-up task to (from spawn_agent).",
            }),
            message: Type.String({
                description: "Message text to send to the target agent.",
                encrypted: true,
            }),
        },
        { additionalProperties: false },
    ),
} as const satisfies SessionTool;
