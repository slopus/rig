import { Type } from "@sinclair/typebox";

import { defineTool } from "../../../types.js";
import { codexAgentStatusSchema } from "../impl/codexAgentStatusSchema.js";
import { requireSubagentContext } from "../impl/requireSubagentContext.js";
import { toCodexAgentStatus } from "../impl/toCodexAgentStatus.js";

export const codexListAgentsTool = defineTool({
    name: "list_agents",
    label: "list_agents",
    namespace: {
        name: "collaboration",
        description: "Tools for spawning and managing sub-agents.",
    },
    description: "List subagents in the current session tree and their latest status.",
    arguments: Type.Object({
        path_prefix: Type.Optional(
            Type.String({ description: "Full task-path prefix used to filter the list." }),
        ),
    }),
    returnType: Type.Object({
        agents: Type.Array(
            Type.Object(
                {
                    agent_name: Type.String(),
                    agent_status: codexAgentStatusSchema,
                },
                { additionalProperties: false },
            ),
        ),
    }),
    shouldReviewInAutoMode: () => false,
    execute: ({ path_prefix }, context) => ({
        agents: Array.from(requireSubagentContext(context).list(path_prefix), (agent) => ({
            agent_name: agent.path || agent.sessionId,
            agent_status: toCodexAgentStatus(agent),
        })),
    }),
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) =>
        result.agents.length === 0
            ? "No subagents have been started."
            : `${result.agents.length} subagent${result.agents.length === 1 ? "" : "s"}.`,
    locks: [],
});
