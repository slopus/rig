/* Grok Build tool contract, modified for Rig. Copyright 2023-2026 SpaceXAI; Apache-2.0. */
import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { readGrokTask } from "./read_grok_task.js";

const taskResultSchema = Type.Object({
    task_id: Type.String(),
    status: Type.String(),
    exit_code: Type.Optional(Type.Number()),
    output: Type.Optional(Type.String()),
});

export const grokGetCommandOrSubagentOutputTool = defineTool({
    name: "get_command_or_subagent_output",
    label: "get_command_or_subagent_output",
    description:
        "Get output or status for one or more background commands or subagents. A positive timeout_ms waits for completion; omit it or pass 0 for a non-blocking snapshot.",
    arguments: Type.Object({
        task_ids: Type.Array(Type.String(), {
            description:
                "Task IDs to query. For one task, pass a one-element array. At most 20 IDs.",
            maxItems: 20,
        }),
        timeout_ms: Type.Optional(
            Type.Integer({
                description:
                    "Maximum wait in milliseconds. A positive value waits; omit or pass 0 to poll.",
                minimum: 0,
            }),
        ),
    }),
    returnType: Type.Object({ results: Type.Array(taskResultSchema) }),
    execute: async ({ task_ids, timeout_ms }, context) => ({
        results: await Promise.all(
            [...new Set(task_ids.map((taskId) => taskId.trim()).filter(Boolean))].map((taskId) =>
                readGrokTask({
                    context,
                    taskId,
                    ...(timeout_ms === undefined ? {} : { timeoutMs: timeout_ms }),
                }),
            ),
        ),
    }),
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) =>
        `Checked ${result.results.length} background task${result.results.length === 1 ? "" : "s"}.`,
    locks: [],
});
