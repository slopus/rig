/* Grok Build tool contract, modified for Rig. Copyright 2023-2026 SpaceXAI; Apache-2.0. */
import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { requireSubagentContext } from "../codex/requireSubagentContext.js";

export const grokSpawnSubagentTool = defineTool({
    name: "spawn_subagent",
    label: "spawn_subagent",
    description:
        "Launch a subagent to handle a concrete, bounded task. Background subagents return immediately and share the current workspace.",
    arguments: Type.Object({
        prompt: Type.String({ description: "The full task prompt for the subagent to execute." }),
        description: Type.String({ description: "Short description of the task in 3-5 words." }),
        subagent_type: Type.Optional(
            Type.String({
                description:
                    'Subagent type. Use "explore" for read-only investigation or "general-purpose" for implementation.',
            }),
        ),
        background: Type.Optional(
            Type.Boolean({
                description:
                    "Return immediately with a subagent_id. Defaults to true; use the output tool to inspect status.",
            }),
        ),
    }),
    returnType: Type.Object({
        subagent_id: Type.String(),
        task_name: Type.String(),
        status: Type.String(),
        output: Type.Optional(Type.String()),
    }),
    execute: async ({ background = true, description, prompt }, context, execution) => {
        const result = await requireSubagentContext(context).spawn(
            {
                background,
                description,
                prompt,
                taskName: toTaskName(description),
                ...(execution.toolCallId === undefined
                    ? {}
                    : { parentToolCallId: execution.toolCallId }),
            },
            execution.signal,
        );
        return {
            subagent_id: result.sessionId,
            task_name: result.taskName,
            status: result.status,
            ...(result.output.length === 0 ? {} : { output: result.output }),
        };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) => `Started subagent ${result.task_name}.`,
    locks: [],
});

function toTaskName(description: string): string {
    const normalized = description
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "_")
        .replace(/^_+|_+$/gu, "")
        .slice(0, 48);
    return normalized || "delegated_task";
}
