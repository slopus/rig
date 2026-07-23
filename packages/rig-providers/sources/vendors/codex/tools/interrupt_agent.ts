import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const interrupt_agent = {
    name: "interrupt_agent",
    namespace: "collaboration",
    type: "local",
    description:
        "Interrupt an agent's current turn, if any, and return its previous status. The agent remains available for messages and follow-up tasks.",
    parameters: Type.Object(
        {
            target: Type.String({
                description: "Agent id or canonical task name to interrupt (from spawn_agent).",
            }),
        },
        { additionalProperties: false },
    ),
} as const satisfies SessionTool;
