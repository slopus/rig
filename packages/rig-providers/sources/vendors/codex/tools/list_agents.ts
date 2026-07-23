import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const list_agents = {
    name: "list_agents",
    namespace: "collaboration",
    type: "local",
    description:
        "List live agents in the current root thread tree. Optionally filter by task-path prefix.",
    parameters: Type.Object(
        {
            path_prefix: Type.Optional(
                Type.String({
                    description:
                        "Task-path prefix filter without a trailing slash. Omit to list all live agents.",
                }),
            ),
        },
        { additionalProperties: false },
    ),
} as const satisfies SessionTool;
