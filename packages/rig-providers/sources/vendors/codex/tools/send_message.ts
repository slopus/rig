import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const send_message = {
    name: "send_message",
    namespace: "collaboration",
    type: "local",
    description:
        "Send a message to an existing agent. The message will be delivered promptly. Does not trigger a new turn.",
    parameters: Type.Object(
        {
            target: Type.String({
                description: "Relative or canonical task name to message (from spawn_agent).",
            }),
            message: Type.String({
                description: "Message text to queue on the target agent.",
                encrypted: true,
            }),
        },
        { additionalProperties: false },
    ),
} as const satisfies SessionTool;
