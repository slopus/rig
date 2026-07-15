/* Grok Build tool contract, modified for Rig. Copyright 2023-2026 SpaceXAI; Apache-2.0. */
import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { readGrokTask } from "./read_grok_task.js";

export const grokWaitCommandsOrSubagentsTool = defineTool({
    name: "wait_commands_or_subagents",
    label: "wait_commands_or_subagents",
    description:
        "Wait until any or all specified background commands or subagents reach a terminal state.",
    arguments: Type.Object({
        task_ids: Type.Array(Type.String(), {
            description: "Task IDs to wait for.",
            maxItems: 20,
        }),
        mode: Type.Union([Type.Literal("wait_any"), Type.Literal("wait_all")], {
            description: "Return when the first task completes or after all tasks complete.",
        }),
        timeout_ms: Type.Optional(
            Type.Integer({ description: "Maximum wait in milliseconds.", minimum: 0 }),
        ),
    }),
    returnType: Type.Object({
        mode: Type.String(),
        results: Type.Array(
            Type.Object({
                task_id: Type.String(),
                status: Type.String(),
                exit_code: Type.Optional(Type.Number()),
                output: Type.Optional(Type.String()),
            }),
        ),
    }),
    execute: async ({ mode, task_ids, timeout_ms = 30_000 }, context) => {
        const ids = [...new Set(task_ids.map((taskId) => taskId.trim()).filter(Boolean))];
        const perTaskTimeout = mode === "wait_all" ? timeout_ms : 0;
        if (mode === "wait_any" && context.subagents !== undefined) {
            await context.subagents.wait(Math.min(timeout_ms, 60_000));
        }
        const results = await Promise.all(
            ids.map((taskId) => readGrokTask({ context, taskId, timeoutMs: perTaskTimeout })),
        );
        return { mode, results };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) =>
        `Waited for ${result.results.length} background task${result.results.length === 1 ? "" : "s"}.`,
    locks: [],
});
