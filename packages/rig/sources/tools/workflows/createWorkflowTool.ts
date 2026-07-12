import { basename } from "node:path";

import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { WorkflowScriptRunner } from "../../workflows/index.js";

const MAX_WORKFLOW_SCRIPT_CHARS = 524_288;

const WORKFLOW_DESCRIPTION = `Run a deterministic multi-agent workflow in the background using sandboxed Python.

Only use this tool when the user explicitly asks for a workflow, multi-agent orchestration, or "ultracode". Workflows can spend substantially more tokens than a normal turn.

The Python script coordinates agents but has no direct filesystem, shell, environment, or network access. Those capabilities remain inside the subagents. The final Python expression becomes the consolidated workflow result. Do not use top-level return.

Available Python globals:
- args: the JSON value passed in this tool call, or None.
- agent(prompt, options={}): run one subagent and return its final text. Options support label and schema. With schema, the agent must return matching JSON and agent() returns the parsed value.
- parallel(requests): run requests concurrently and return results in input order. Each request is a prompt string or {"prompt": str, "label": str, "schema": object}. Failed items become None.
- pipeline(items, stages): process all items concurrently through sequential stages. Each stage is a prompt string or request dictionary. The original item and previous result are appended to every stage prompt. Failed items become None.
- phase(title): group later agent calls under a human-readable phase.
- log(message): include a progress note in the workflow run.
- print(...): also records a progress note.

External calls block until their host operation completes, even though subagents run asynchronously. Call agent(), parallel(), and pipeline() directly; do not write await. Use parallel for a barrier and pipeline when every item can advance independently.

Example:
phase("Review")
reviews = parallel([
    {"prompt": "Review authentication for bugs.", "label": "Auth review"},
    {"prompt": "Review storage for bugs.", "label": "Storage review"},
])
phase("Verify")
verified = pipeline(
    [review for review in reviews if review is not None],
    [{"prompt": "Adversarially verify this finding.", "label": "Verify finding"}],
)
{"verified": [result for result in verified if result is not None]}

Runs are capped at 1,000 total agents and queued at the session's subagent concurrency limit. The tool returns immediately with a task ID. A workflow notification arrives when the consolidated result is ready. Pass resumeFromRunId to reuse unchanged completed agent calls from a stopped or completed run.`;

export function createWorkflowTool(name: "Workflow" | "workflow") {
    return defineTool({
        name,
        label: name,
        description: WORKFLOW_DESCRIPTION,
        arguments: Type.Object({
            args: Type.Optional(
                Type.Unknown({ description: "JSON input exposed to the script as args." }),
            ),
            description: Type.Optional(
                Type.String({
                    description: "One sentence describing the workflow's outcome.",
                    maxLength: 1_000,
                }),
            ),
            name: Type.Optional(
                Type.String({ description: "Short lowercase workflow name.", maxLength: 128 }),
            ),
            resumeFromRunId: Type.Optional(
                Type.String({ description: "Prior workflow run to resume in this session." }),
            ),
            script: Type.Optional(
                Type.String({
                    description: "Inline sandboxed Python workflow script.",
                    maxLength: MAX_WORKFLOW_SCRIPT_CHARS,
                }),
            ),
            scriptPath: Type.Optional(
                Type.String({ description: "Path to a saved Python workflow script." }),
            ),
        }),
        returnType: Type.Object({
            description: Type.String(),
            name: Type.String(),
            runId: Type.String(),
            status: Type.Literal("async_launched"),
            taskId: Type.String(),
        }),
        execute: async (
            { args, description, name: requestedName, resumeFromRunId, script, scriptPath },
            context,
            execution,
        ) => {
            if (context.workflows === undefined) {
                throw new Error("Workflows are unavailable in this session.");
            }
            if (context.subagents === undefined || !context.subagents.canSpawn) {
                throw new Error("This session cannot start workflow agents.");
            }
            if (script === undefined && scriptPath === undefined) {
                throw new Error("Provide an inline script or a saved script path.");
            }
            if (script !== undefined && scriptPath !== undefined) {
                throw new Error(
                    "Provide either an inline script or a saved script path, not both.",
                );
            }
            const source =
                scriptPath === undefined ? (script ?? "") : await context.fs.readFile(scriptPath);
            if (source.length > MAX_WORKFLOW_SCRIPT_CHARS) {
                throw new Error("Workflow scripts are limited to 524,288 characters.");
            }
            const workflowName =
                requestedName?.trim() ||
                (scriptPath === undefined
                    ? "dynamic-workflow"
                    : basename(scriptPath).replace(/\.py$/i, ""));
            const workflowDescription = description?.trim() || `Run ${workflowName}`;
            const run = context.workflows.launch({
                description: workflowDescription,
                execute: async (options) =>
                    new WorkflowScriptRunner({
                        agentContext: context,
                        args: args ?? null,
                        onAgentCall: options.onAgentCall,
                        onAgentResult: options.onAgentResult,
                        onLog: options.onLog,
                        ...(execution.toolCallId === undefined
                            ? {}
                            : { parentToolCallId: execution.toolCallId }),
                        resumeAgentCalls: options.resumeAgentCalls,
                        signal: options.signal,
                        workflowRunId: options.runId,
                    }).run(source),
                name: workflowName,
                ...(resumeFromRunId === undefined ? {} : { resumeFromRunId }),
            });
            return {
                description: workflowDescription,
                name: workflowName,
                runId: run.runId,
                status: "async_launched" as const,
                taskId: run.taskId,
            };
        },
        toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
        toUI: (result) => `Started workflow ${result.name}.`,
        locks: [],
    });
}
