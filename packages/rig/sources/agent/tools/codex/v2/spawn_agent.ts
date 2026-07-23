import { Type } from "@sinclair/typebox";

import { defineTool } from "../../../types.js";
import { humanizeTaskName } from "../impl/humanizeTaskName.js";
import { parseCodexForkTurns } from "./impl/parseCodexForkTurns.js";
import { requireSubagentContext } from "../impl/requireSubagentContext.js";
import { selectLastUserTurns } from "./impl/selectLastUserTurns.js";

export const codexSpawnAgentTool = defineTool({
    name: "spawn_agent",
    label: "spawn_agent",
    namespace: {
        name: "collaboration",
        description: "Tools for spawning and managing sub-agents.",
    },
    description:
        "Spawn a background subagent for a concrete, bounded task. The new agent shares the workspace and reports back when it finishes.",
    arguments: Type.Object(
        {
            task_name: Type.String({
                description: "Lowercase task name using letters, numbers, and underscores.",
            }),
            message: Type.String({
                description: "Initial plain-text task for the new agent.",
                encrypted: true,
            }),
            fork_turns: Type.Optional(
                Type.String({
                    description:
                        "Optional number of turns to fork. Defaults to `all`. Use `none`, `all`, or a positive integer string such as `3` to fork only the most recent turns.",
                }),
            ),
            model: Type.Optional(
                Type.String({
                    description:
                        "Child model ID. The provider is inferred from the current provider or a unique match when omitted.",
                }),
            ),
            reasoning_effort: Type.Optional(
                Type.String({
                    description:
                        "Reasoning effort override for the new agent. Omit to inherit the parent effort.",
                }),
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
        const { fork_turns, message, model, reasoning_effort, task_name } = args;
        const subagents = requireSubagentContext(context);
        const fork = parseCodexForkTurns(fork_turns);
        const parentMessages = execution.messages?.slice(0, -1);
        const result = await subagents.spawn({
            background: true,
            contextMode: fork.contextMode,
            ...(fork.contextMode === "parent" && parentMessages !== undefined
                ? { contextMessages: selectLastUserTurns(parentMessages, fork.lastNTurns) }
                : {}),
            description: humanizeTaskName(task_name),
            ...(subagents.encryptedMessages === true ? { encryptedPrompt: message } : {}),
            ...(reasoning_effort === undefined ? {} : { effort: reasoning_effort }),
            ...(model === undefined ? {} : { modelId: model }),
            ...(execution.toolCallId === undefined
                ? {}
                : { parentToolCallId: execution.toolCallId }),
            prompt: subagents.encryptedMessages === true ? "" : message,
            taskName: task_name,
        });
        return { agent_id: result.sessionId, path: result.path, task_name: result.taskName };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) => `Started background task ${humanizeTaskName(result.task_name)}.`,
    locks: [],
});
