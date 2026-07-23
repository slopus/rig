import { Type } from "@sinclair/typebox";

import { defineTool } from "../../../types.js";
import { managedSubagentSchema } from "../impl/subagentSchemas.js";
import { requireSubagentContext } from "../impl/requireSubagentContext.js";

export const codexInterruptAgentTool = defineTool({
    name: "interrupt_agent",
    label: "interrupt_agent",
    namespace: {
        name: "collaboration",
        description: "Tools for spawning and managing sub-agents.",
    },
    description:
        "Stop an existing subagent's current turn. The agent remains available for later follow-up work.",
    arguments: Type.Object({
        target: Type.String({ description: "Agent id, task name, or full task path." }),
    }),
    returnType: managedSubagentSchema,
    shouldReviewInAutoMode: () => false,
    execute: ({ target }, context) => requireSubagentContext(context).interrupt(target),
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) => `Stopped the current turn for ${result.description}.`,
    locks: [],
});
