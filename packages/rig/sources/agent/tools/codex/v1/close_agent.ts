import { Type } from "@sinclair/typebox";

import { defineTool } from "../../../types.js";
import { codexAgentStatusSchema } from "../impl/codexAgentStatusSchema.js";
import { findManagedSubagent } from "../impl/findManagedSubagent.js";
import { requireSubagentContext } from "../impl/requireSubagentContext.js";
import { toCodexAgentStatus } from "../impl/toCodexAgentStatus.js";

export const codexV1CloseAgentTool = defineTool({
    name: "close_agent",
    label: "close_agent",
    namespace: {
        name: "multi_agent_v1",
        description: "Tools for spawning and managing sub-agents.",
    },
    description:
        "Close an agent and any open descendants when they are no longer needed, and return the target agent's previous status before shutdown was requested.",
    arguments: Type.Object(
        {
            target: Type.String({
                description: "Agent id to close (from spawn_agent).",
            }),
        },
        { additionalProperties: false },
    ),
    returnType: Type.Object({
        previous_status: codexAgentStatusSchema,
    }),
    shouldReviewInAutoMode: () => false,
    execute: ({ target }, context) => {
        const subagents = requireSubagentContext(context);
        const previous = findManagedSubagent(subagents, target);
        subagents.interrupt(target);
        return { previous_status: toCodexAgentStatus(previous) };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: () => "Closed the subagent.",
    locks: [],
});
