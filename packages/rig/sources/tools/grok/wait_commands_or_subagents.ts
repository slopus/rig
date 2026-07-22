/* Grok Build tool contract, modified for Rig. Copyright 2023-2026 SpaceXAI; Apache-2.0. */
import { Type } from "@sinclair/typebox";

import {
    DEFAULT_SUBAGENT_WAIT_TIMEOUT_MS,
    MAX_SUBAGENT_WAIT_TIMEOUT_MS,
} from "../../agent/context/subagentWaitTimeouts.js";
import { defineTool } from "../../agent/types.js";
import { waitForGrokTasks } from "./waitForGrokTasks.js";

export const grokWaitCommandsOrSubagentsTool = defineTool({
    name: "wait_commands_or_subagents",
    label: "wait_commands_or_subagents",
    description:
        "Wait until any or all specified background commands or subagents reach a terminal state.",
    arguments: Type.Object({
        task_ids: Type.Array(Type.String(), {
            description: "Task IDs to wait for.",
            maxItems: 20,
            minItems: 1,
        }),
        mode: Type.Union([Type.Literal("wait_any"), Type.Literal("wait_all")], {
            description: "Return when the first task completes or after all tasks complete.",
        }),
        timeout_ms: Type.Optional(
            Type.Integer({
                description: `Maximum wait in milliseconds. Defaults to ${DEFAULT_SUBAGENT_WAIT_TIMEOUT_MS}, max ${MAX_SUBAGENT_WAIT_TIMEOUT_MS}.`,
                maximum: MAX_SUBAGENT_WAIT_TIMEOUT_MS,
                minimum: 0,
            }),
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
    interruptionMessage: "Waiting for background tasks was interrupted by new input.",
    shouldReviewInAutoMode: () => false,
    steerable: true,
    execute: async (
        { mode, task_ids, timeout_ms = DEFAULT_SUBAGENT_WAIT_TIMEOUT_MS },
        context,
        execution,
    ) => {
        const ids = [...new Set(task_ids.map((taskId) => taskId.trim()).filter(Boolean))];
        if (ids.length === 0) throw new Error("Provide at least one non-empty task ID.");
        const results = await waitForGrokTasks({
            context,
            mode,
            ...(execution.signal === undefined ? {} : { signal: execution.signal }),
            taskIds: ids,
            timeoutMs: timeout_ms,
        });
        return { mode, results };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) =>
        `Waited for ${result.results.length} background task${result.results.length === 1 ? "" : "s"}.`,
    locks: [],
});
