import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const wait_agent = {
    name: "wait_agent",
    namespace: "collaboration",
    type: "local",
    description:
        "Wait for a mailbox update from any live agent, including queued messages and final-status notifications. The wait also ends early when new user input is steered into the active turn. Does not return the content; returns either a summary of which agents have updates (if any), an interruption summary for steered input, or a timeout summary if no activity arrives before the deadline.",
    parameters: Type.Object(
        {
            timeout_ms: Type.Optional(
                Type.Number({
                    description:
                        "Timeout in milliseconds. Defaults to 30000, min 10000, max 3600000.",
                }),
            ),
        },
        { additionalProperties: false },
    ),
} as const satisfies SessionTool;
