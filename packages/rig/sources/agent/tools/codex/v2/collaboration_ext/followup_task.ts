import { Type } from "@sinclair/typebox";

import { defineTool } from "../../../../types.js";
import { managedSubagentSchema } from "../../impl/subagentSchemas.js";
import { requireSubagentContext } from "../../impl/requireSubagentContext.js";

export const codexExtendedFollowupTaskTool = defineTool({
    name: "followup_task",
    label: "followup_task",
    namespace: {
        name: "collaboration_ext",
        description: "Tools for spawning sub-agents across providers and model families.",
    },
    description: `Allowed targets: any existing subagent, including agents started with a different provider or model family.
Use this tool for non-GPT or cross-provider agents. Prefer \`collaboration.followup_task\` for compatible GPT agents because the native tool preserves Codex's encrypted collaboration transport.

Send plaintext follow-up work to an existing subagent and trigger another turn when it is idle.`,
    arguments: Type.Object(
        {
            target: Type.String({
                description: "Agent id, task name, or full task path.",
            }),
            message: Type.String({
                description: "Plain-text follow-up task for the target agent.",
            }),
            reasoning_effort: Type.Optional(
                Type.String({
                    description:
                        "Reasoning effort override for this turn. Omit to keep the agent's current effort.",
                }),
            ),
        },
        { additionalProperties: false },
    ),
    returnType: managedSubagentSchema,
    shouldReviewInAutoMode: () => false,
    execute: (args, context) => {
        const { message, reasoning_effort, target } = args;
        return requireSubagentContext(context).followUp(target, message, reasoning_effort);
    },
    toLLM: () => [{ type: "text", text: "" }],
    toUI: (result) => `Sent follow-up work to ${result.description}.`,
    locks: [],
});
