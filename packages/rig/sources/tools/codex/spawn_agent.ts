import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { humanizeTaskName } from "./humanizeTaskName.js";
import { requireSubagentContext } from "./requireSubagentContext.js";
import { selectLastUserTurns } from "./selectLastUserTurns.js";

export const codexSpawnAgentTool = defineTool({
    name: "spawn_agent",
    label: "spawn_agent",
    description:
        "Spawn a background subagent for a concrete, bounded task. The new agent shares the workspace and reports back when it finishes.",
    arguments: Type.Object(
        {
            context: Type.Union([Type.Literal("parent"), Type.Literal("task")], {
                description:
                    "Use parent to continue with the parent thread context, or task to start with only the delegated message.",
            }),
            task_name: Type.String({
                description: "Lowercase task name using letters, numbers, and underscores.",
            }),
            message: Type.String({ description: "Complete instructions for the new agent." }),
            effort: Type.Optional(
                Type.String({
                    description:
                        "Child effort level. Must be one of the allowed effort levels shown in the system prompt for the selected model.",
                }),
            ),
            model: Type.Optional(
                Type.String({
                    description:
                        "Child model ID. The provider is inferred from the current provider or a unique match when omitted.",
                }),
            ),
            provider: Type.Optional(
                Type.String({ description: "Child provider ID. Requires an explicit model." }),
            ),
        },
        { additionalProperties: false },
    ),
    returnType: Type.Object({
        agent_id: Type.String(),
        path: Type.String(),
        task_name: Type.String(),
    }),
    shouldReviewInAutoMode: () => false,
    execute: async (args, context, execution) => {
        const {
            context: contextMode,
            effort,
            message,
            model,
            provider,
            service_tier,
            task_name,
            encrypted_message,
            last_n_turns,
        } = args as typeof args & {
            encrypted_message?: string;
            last_n_turns?: number;
            service_tier?: "fast";
        };
        const parentMessages = execution.messages?.slice(0, -1);
        const result = await requireSubagentContext(context).spawn({
            background: true,
            contextMode,
            ...(contextMode === "parent" && parentMessages !== undefined
                ? { contextMessages: selectLastUserTurns(parentMessages, last_n_turns) }
                : {}),
            description: humanizeTaskName(task_name),
            ...(encrypted_message === undefined ? {} : { encryptedPrompt: encrypted_message }),
            ...(effort === undefined ? {} : { effort }),
            ...(model === undefined ? {} : { modelId: model }),
            ...(execution.toolCallId === undefined
                ? {}
                : { parentToolCallId: execution.toolCallId }),
            prompt: message,
            ...(provider === undefined ? {} : { providerId: provider }),
            ...(service_tier === undefined ? {} : { serviceTier: service_tier }),
            taskName: task_name,
        });
        return { agent_id: result.sessionId, path: result.path, task_name: result.taskName };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) => `Started background task ${humanizeTaskName(result.task_name)}.`,
    locks: [],
});
