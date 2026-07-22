import { Type, type Static } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { readSessionWithProgress } from "../utils/readSessionWithProgress.js";
import { boundShellOutput } from "../utils/boundShellOutput.js";
import { parseBackgroundTaskId } from "./parseBackgroundTaskId.js";
import { serializeWorkflowValue } from "../../workflows/index.js";

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

const workflowTaskSchema = Type.Object({
    agent_count: Type.Number(),
    description: Type.String(),
    error: Type.Optional(Type.String()),
    logs: Type.Array(Type.String()),
    name: Type.String(),
    output: Type.Optional(Type.String()),
    status: Type.Union([
        Type.Literal("completed"),
        Type.Literal("error"),
        Type.Literal("running"),
        Type.Literal("stopped"),
    ]),
    task_id: Type.String(),
    task_type: Type.Literal("workflow"),
});

const taskOutputReturnSchema = Type.Object({
    retrieval_status: Type.Union([
        Type.Literal("not_ready"),
        Type.Literal("success"),
        Type.Literal("timeout"),
    ]),
    task: Type.Union([backgroundTaskSchema, workflowTaskSchema, Type.Null()]),
});

export const claudeTaskOutputTool = defineTool({
    name: "TaskOutput",
    label: "TaskOutput",
    description: "Read output from a running or completed background shell task or workflow.",
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
    returnType: taskOutputReturnSchema,
    interruptionMessage: "Waiting for background task output was interrupted by new input.",
    shouldReviewInAutoMode: () => false,
    steerable: true,
    execute: async (
        { block = true, task_id, timeout = 30_000 },
        context,
        execution,
    ): Promise<Static<typeof taskOutputReturnSchema>> => {
        if (task_id.startsWith("workflow:")) {
            const runId = task_id.slice("workflow:".length);
            let run = context.workflows?.get(runId);
            if (run === undefined) throw new Error("The workflow run was not found.");
            if (block && run.status === "running") {
                const deadline = Date.now() + timeout;
                while (run.status === "running" && Date.now() < deadline) {
                    if (execution.signal?.aborted)
                        throw new Error("Waiting for the workflow was cancelled.");
                    await new Promise((resolve) =>
                        setTimeout(resolve, Math.min(100, deadline - Date.now())),
                    );
                    run = context.workflows?.get(runId) ?? run;
                }
            }
            return {
                retrieval_status:
                    run.status === "running"
                        ? block
                            ? ("timeout" as const)
                            : ("not_ready" as const)
                        : ("success" as const),
                task: {
                    agent_count: run.agentCount,
                    description: run.description,
                    ...(run.error === undefined ? {} : { error: run.error }),
                    logs: Array.from(run.logs),
                    name: run.name,
                    ...(run.output === undefined
                        ? {}
                        : { output: serializeWorkflowValue(run.output) }),
                    status: run.status,
                    task_id,
                    task_type: "workflow" as const,
                },
            };
        }
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
                output: boundShellOutput(
                    [snapshot.stdout, snapshot.stderr]
                        .filter((value) => value.length > 0)
                        .join("\n"),
                ),
                status: snapshot.status,
                task_id,
                task_type: "local_bash",
            },
        };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) => {
        const isWorkflow = result.task?.task_type === "workflow";
        if (result.retrieval_status === "success") {
            return isWorkflow ? "Workflow output is ready." : "Background command output is ready.";
        }
        if (result.retrieval_status === "timeout") {
            return isWorkflow
                ? "Workflow is still running after the wait."
                : "Background task is still running after the wait.";
        }
        return isWorkflow ? "Workflow is still running." : "Background task is still running.";
    },
    locks: [],
});
