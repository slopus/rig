import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { managedSubagentSchema } from "./subagentSchemas.js";
import { requireSubagentContext } from "./requireSubagentContext.js";

export const codexListAgentsTool = defineTool({
    name: "list_agents",
    label: "list_agents",
    description: "List subagents in the current session tree and their latest status.",
    arguments: Type.Object({
        path_prefix: Type.Optional(
            Type.String({ description: "Full task-path prefix used to filter the list." }),
        ),
    }),
    returnType: Type.Object({ agents: Type.Array(managedSubagentSchema) }),
    execute: ({ path_prefix }, context) => ({
        agents: Array.from(requireSubagentContext(context).list(path_prefix), (agent) => ({
            ...agent,
        })),
    }),
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) =>
        result.agents.length === 0
            ? "No subagents have been started."
            : `${result.agents.length} subagent${result.agents.length === 1 ? "" : "s"}.`,
    locks: [],
});
