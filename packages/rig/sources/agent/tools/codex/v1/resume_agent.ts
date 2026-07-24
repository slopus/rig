import { Type } from "@sinclair/typebox";

import { findManagedSubagent } from "../../../context/findManagedSubagent.js";
import { defineTool } from "../../../types.js";
import { codexAgentStatusSchema } from "../impl/codexAgentStatusSchema.js";
import { requireSubagentContext } from "../impl/requireSubagentContext.js";
import { toCodexAgentStatus } from "../impl/toCodexAgentStatus.js";

export const codexV1ResumeAgentTool = defineTool({
    name: "resume_agent",
    label: "resume_agent",
    namespace: {
        name: "multi_agent_v1",
        description: "Tools for spawning and managing sub-agents.",
    },
    description:
        "Resume a previously closed agent by id so it can receive send_input and wait_agent calls.",
    arguments: Type.Object(
        {
            id: Type.String({ description: "Agent id to resume." }),
        },
        { additionalProperties: false },
    ),
    returnType: Type.Object({
        status: codexAgentStatusSchema,
    }),
    shouldReviewInAutoMode: () => false,
    execute: ({ id }, context) => {
        const subagents = requireSubagentContext(context);
        return { status: toCodexAgentStatus(findManagedSubagent(subagents, id)) };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: () => "Made the subagent available for more work.",
    locks: [],
});
