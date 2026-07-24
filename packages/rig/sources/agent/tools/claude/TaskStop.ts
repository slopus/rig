import { Type } from "@sinclair/typebox";

import { resolveManagedSubagent } from "../../context/resolveManagedSubagent.js";
import { defineTool } from "../../types.js";
import { parseBackgroundTaskId } from "../../../tools/claude/parseBackgroundTaskId.js";

export const claudeTaskStopTool = defineTool({
    name: "TaskStop",
    label: "TaskStop",
    description: "Stop a running background shell task, agent, or workflow by its identifier.",
    arguments: Type.Object(
        {
            task_id: Type.String({ description: "The background task identifier." }),
        },
        { additionalProperties: false },
    ),
    returnType: Type.Union([
        Type.Object({
            command: Type.String(),
            message: Type.String(),
            task_id: Type.String(),
            task_type: Type.Literal("local_bash"),
        }),
        Type.Object({
            message: Type.String(),
            name: Type.String(),
            task_id: Type.String(),
            task_type: Type.Literal("workflow"),
        }),
        Type.Object({
            command: Type.String(),
            message: Type.String(),
            task_id: Type.String(),
            task_type: Type.Literal("local_agent"),
        }),
    ]),
    shouldReviewInAutoMode: () => false,
    execute: async ({ task_id: id }, context) => {
        const agent = resolveManagedSubagent(context.subagents, id);
        if (agent !== undefined && context.subagents !== undefined) {
            if (agent.status !== "running" && agent.status !== "suspended") {
                throw new Error("The background agent is not running.");
            }
            context.subagents.interrupt(agent.sessionId);
            return {
                command: agent.description,
                message: "The background agent was stopped.",
                task_id: agent.sessionId,
                task_type: "local_agent" as const,
            };
        }
        if (id.startsWith("workflow:")) {
            const run = context.workflows?.stop(id.slice("workflow:".length));
            if (run === undefined) throw new Error("The workflow run was not found.");
            if (run.status !== "stopped") throw new Error("The workflow is no longer running.");
            return {
                message: "The workflow was stopped.",
                name: run.name,
                task_id: id,
                task_type: "workflow" as const,
            };
        }
        const sessionId = parseBackgroundTaskId(id);
        const current = await context.bash.readSession(sessionId);
        if (current === undefined) throw new Error("The background task was not found.");
        if (current.status !== "running") {
            throw new Error("The background task is not running.");
        }
        const snapshot = await context.bash.killSession(sessionId);
        if (snapshot === undefined) throw new Error("The background task was not found.");
        return {
            command: snapshot.command,
            message: "The background command was stopped.",
            task_id: id,
            task_type: "local_bash",
        };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) => result.message,
    locks: [],
});
