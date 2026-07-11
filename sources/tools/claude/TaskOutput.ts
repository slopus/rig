import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { readSessionWithProgress } from "../utils/readSessionWithProgress.js";
import { parseBackgroundTaskId } from "./parseBackgroundTaskId.js";

const backgroundTaskSchema = Type.Object({
    command: Type.String(),
    description: Type.String(),
    exitCode: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    output: Type.String(),
    status: Type.Union([
        Type.Literal("completed"),
        Type.Literal("killed"),
        Type.Literal("running"),
    ]),
    task_id: Type.String(),
    task_type: Type.Literal("local_bash"),
});

export const claudeTaskOutputTool = defineTool({
    name: "TaskOutput",
    label: "TaskOutput",
    description: "Read output from a running or completed background shell task.",
    arguments: Type.Object({
        task_id: Type.String({ description: "The background task identifier." }),
        block: Type.Optional(
            Type.Boolean({ description: "Whether to wait for the task to finish." }),
        ),
        timeout: Type.Optional(
            Type.Number({
                description: "Maximum wait in milliseconds.",
                maximum: 600_000,
                minimum: 0,
            }),
        ),
    }),
    returnType: Type.Object({
        retrieval_status: Type.Union([
            Type.Literal("not_ready"),
            Type.Literal("success"),
            Type.Literal("timeout"),
        ]),
        task: Type.Union([backgroundTaskSchema, Type.Null()]),
    }),
    execute: async ({ block = true, task_id, timeout = 30_000 }, context, execution) => {
        const sessionId = parseBackgroundTaskId(task_id);
        const snapshot = await readSessionWithProgress({
            bash: context.bash,
            ...(execution.onProgress === undefined ? {} : { onProgress: execution.onProgress }),
            sessionId,
            ...(execution.signal === undefined ? {} : { signal: execution.signal }),
            waitMs: block ? timeout : 0,
        });
        if (snapshot === undefined) {
            throw new Error("The background task was not found.");
        }
        const stillRunning = snapshot.status === "running";
        return {
            retrieval_status: stillRunning ? (block ? "timeout" : "not_ready") : "success",
            task: {
                command: snapshot.command,
                description: snapshot.command,
                ...(stillRunning ? {} : { exitCode: snapshot.exitCode }),
                output: [snapshot.stdout, snapshot.stderr]
                    .filter((value) => value.length > 0)
                    .join("\n"),
                status: snapshot.status,
                task_id,
                task_type: "local_bash",
            },
        };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) =>
        result.retrieval_status === "success"
            ? "Background command output is ready."
            : result.retrieval_status === "timeout"
              ? "Background command is still running after the wait."
              : "Background command is still running.",
    locks: [],
});
