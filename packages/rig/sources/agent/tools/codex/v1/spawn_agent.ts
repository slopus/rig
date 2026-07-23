import { Type } from "@sinclair/typebox";

import { defineTool } from "../../../types.js";
import { requireSubagentContext } from "../impl/requireSubagentContext.js";
import { collaborationItemsSchema } from "./collaborationItemsSchema.js";
import { collaborationItemsToText } from "./collaborationItemsToText.js";

export const codexV1SpawnAgentTool = defineTool({
    name: "spawn_agent",
    label: "spawn_agent",
    namespace: {
        name: "multi_agent_v1",
        description: "Tools for spawning and managing sub-agents.",
    },
    description: "Spawn a subagent using the legacy plaintext Codex collaboration protocol.",
    arguments: Type.Object(
        {
            message: Type.Optional(
                Type.String({
                    description:
                        "Initial plain-text task for the new agent. Use either message or items.",
                }),
            ),
            items: Type.Optional(collaborationItemsSchema),
            agent_type: Type.Optional(Type.String()),
            fork_context: Type.Optional(
                Type.Boolean({
                    description:
                        "True forks the current thread history into the new agent; false or omitted starts with only the initial prompt.",
                }),
            ),
            model: Type.Optional(Type.String()),
            reasoning_effort: Type.Optional(Type.String()),
            service_tier: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
    ),
    returnType: Type.Object({
        agent_id: Type.String(),
        nickname: Type.Optional(Type.String()),
    }),
    shouldReviewInAutoMode: () => false,
    execute: async (args, context, execution) => {
        const prompt = [args.message, collaborationItemsToText(args.items)]
            .filter((value): value is string => value !== undefined && value.length > 0)
            .join("\n");
        if (prompt.length === 0) throw new Error("spawn_agent requires message or items.");
        const parentMessages = execution.messages?.slice(0, -1);
        const result = await requireSubagentContext(context).spawn({
            background: true,
            contextMode: args.fork_context === true ? "parent" : "task",
            ...(args.fork_context === true && parentMessages !== undefined
                ? { contextMessages: parentMessages }
                : {}),
            description: "Delegated task",
            ...(args.reasoning_effort === undefined ? {} : { effort: args.reasoning_effort }),
            ...(args.model === undefined ? {} : { modelId: args.model }),
            ...(execution.toolCallId === undefined
                ? {}
                : { parentToolCallId: execution.toolCallId }),
            prompt,
            ...(args.service_tier === "priority" ? { serviceTier: "fast" as const } : {}),
        });
        return { agent_id: result.sessionId, nickname: result.taskName };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) => `Started background task ${result.nickname ?? result.agent_id}.`,
    locks: [],
});
