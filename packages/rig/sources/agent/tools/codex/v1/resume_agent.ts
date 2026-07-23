import { Type } from "@sinclair/typebox";

import { defineTool } from "../../../types.js";
import { managedSubagentSchema } from "../impl/subagentSchemas.js";
import { requireSubagentContext } from "../impl/requireSubagentContext.js";

export const codexV1ResumeAgentTool = defineTool({
    name: "resume_agent",
    label: "resume_agent",
    namespace: {
        name: "multi_agent_v1",
        description: "Tools for spawning and managing sub-agents.",
    },
    description: "Resume a previously closed agent so it can receive more work.",
    arguments: Type.Object(
        {
            id: Type.String({ description: "Agent id to resume." }),
        },
        { additionalProperties: false },
    ),
    returnType: managedSubagentSchema,
    shouldReviewInAutoMode: () => false,
    execute: ({ id }, context) =>
        requireSubagentContext(context).followUp(
            id,
            "Continue the delegated task from where you stopped.",
        ),
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) => `Resumed ${result.description}.`,
    locks: [],
});
