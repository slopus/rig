/* Grok Build tool contract, modified for Rig. Copyright 2023-2026 SpaceXAI; Apache-2.0. */
import { Type } from "@sinclair/typebox";

import { MAX_SUBAGENT_WAIT_TIMEOUT_MS } from "../../agent/context/subagentWaitTimeouts.js";
import { defineTool } from "../../agent/types.js";
import { readGrokTask } from "./read_grok_task.js";
import { waitForGrokTasks } from "./waitForGrokTasks.js";

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
            minItems: 1,
        }),
        timeout_ms: Type.Optional(
            Type.Integer({
                description:
                    "Maximum wait in milliseconds. A positive value waits; omit or pass 0 to poll.",
                maximum: MAX_SUBAGENT_WAIT_TIMEOUT_MS,
                minimum: 0,
            }),
        ),
    }),
    returnType: Type.Object({ results: Type.Array(taskResultSchema) }),
    interruptionMessage: "Waiting for background task output was interrupted by new input.",
    shouldReviewInAutoMode: () => false,
    steerable: true,
    execute: async ({ task_ids, timeout_ms = 0 }, context, execution) => {
        const ids = [...new Set(task_ids.map((taskId) => taskId.trim()).filter(Boolean))];
        if (ids.length === 0) throw new Error("Provide at least one non-empty task ID.");
        return {
            results:
                timeout_ms > 0
                    ? await waitForGrokTasks({
                          context,
                          mode: "wait_all",
                          ...(execution.signal === undefined ? {} : { signal: execution.signal }),
                          taskIds: ids,
                          timeoutMs: timeout_ms,
                      })
                    : await Promise.all(
                          ids.map((taskId) => readGrokTask({ context, taskId, timeoutMs: 0 })),
                      ),
        };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) =>
        `Checked ${result.results.length} background task${result.results.length === 1 ? "" : "s"}.`,
    locks: [],
});
