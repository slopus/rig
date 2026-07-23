import { Type } from "@sinclair/typebox";

import { defineTool } from "../../../types.js";
import { managedSubagentSchema } from "../impl/subagentSchemas.js";
import { requireSubagentContext } from "../impl/requireSubagentContext.js";

export const codexV1CloseAgentTool = defineTool({
    name: "close_agent",
    label: "close_agent",
    namespace: {
        name: "multi_agent_v1",
        description: "Tools for spawning and managing sub-agents.",
    },
    description: "Close an agent and its descendants when they are no longer needed.",
    arguments: Type.Object(
        {
            target: Type.String({
                description: "Agent id to close (from spawn_agent).",
            }),
        },
        { additionalProperties: false },
    ),
    returnType: managedSubagentSchema,
    shouldReviewInAutoMode: () => false,
    execute: ({ target }, context) => requireSubagentContext(context).interrupt(target),
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) => `Closed ${result.description}.`,
    locks: [],
});
