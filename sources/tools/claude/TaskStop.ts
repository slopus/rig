import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { parseBackgroundTaskId } from "./parseBackgroundTaskId.js";

export const claudeTaskStopTool = defineTool({
    name: "TaskStop",
    label: "TaskStop",
    description: "Stop a running background shell task by its identifier.",
    arguments: Type.Object({
        task_id: Type.Optional(Type.String({ description: "The background task identifier." })),
        shell_id: Type.Optional(
            Type.String({ description: "Legacy alias for the background task identifier." }),
        ),
    }),
    returnType: Type.Object({
        command: Type.String(),
        message: Type.String(),
        task_id: Type.String(),
        task_type: Type.Literal("local_bash"),
    }),
    execute: async ({ shell_id, task_id }, context) => {
        const id = task_id ?? shell_id;
        if (id === undefined) throw new Error("A background task identifier is required.");
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
