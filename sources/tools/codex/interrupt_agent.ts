import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { managedSubagentSchema } from "./subagentSchemas.js";
import { requireSubagentContext } from "./requireSubagentContext.js";

export const codexInterruptAgentTool = defineTool({
    name: "interrupt_agent",
    label: "interrupt_agent",
    description:
        "Stop an existing subagent's current turn. The agent remains available for later follow-up work.",
    arguments: Type.Object({
        target: Type.String({ description: "Agent id, task name, or full task path." }),
    }),
    returnType: managedSubagentSchema,
    execute: ({ target }, context) => requireSubagentContext(context).interrupt(target),
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) => `Stopped the current turn for ${result.description}.`,
    locks: [],
});
