/* Grok Build tool contract, modified for Rig. Copyright 2023-2026 SpaceXAI; Apache-2.0. */
import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";

export const grokKillCommandOrSubagentTool = defineTool({
    name: "kill_command_or_subagent",
    label: "kill_command_or_subagent",
    description: "Terminate a running background command or subagent by task ID.",
    arguments: Type.Object({
        task_id: Type.String({ description: "The task ID to terminate." }),
    }),
    returnType: Type.Object({
        task_id: Type.String(),
        outcome: Type.String(),
        message: Type.String(),
    }),
    execute: async ({ task_id }, context) => {
        const terminalId = Number(task_id);
        if (Number.isInteger(terminalId) && terminalId >= 0) {
            const snapshot = await context.bash.killSession(terminalId);
            return snapshot === undefined
                ? { task_id, outcome: "not_found", message: `Command ${task_id} was not found.` }
                : { task_id, outcome: "killed", message: `Command ${task_id} was terminated.` };
        }

        if (context.subagents === undefined) {
            return { task_id, outcome: "not_found", message: `Task ${task_id} was not found.` };
        }
        try {
            const stopped = context.subagents.interrupt(task_id);
            return {
                task_id: stopped.sessionId,
                outcome: "killed",
                message: `Subagent ${stopped.description} was stopped.`,
            };
        } catch {
            return { task_id, outcome: "not_found", message: `Task ${task_id} was not found.` };
        }
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) => result.message,
    locks: [],
});
