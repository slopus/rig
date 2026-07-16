import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { serializeWorkflowValue } from "../../workflows/index.js";

const waitForWorkflowReturnSchema = Type.Object({
    agent_count: Type.Number(),
    error: Type.Optional(Type.String()),
    logs: Type.Array(Type.String()),
    name: Type.String(),
    output: Type.Optional(Type.String()),
    run_id: Type.String(),
    status: Type.Union([Type.Literal("completed"), Type.Literal("error"), Type.Literal("stopped")]),
});

const WAIT_DESCRIPTION = `Wait indefinitely for one workflow run to finish and return its consolidated result.

Use this after starting a workflow when the user asked you to wait for its result. Call it once instead of polling workflow status or ending your turn. The call remains active for workflows of any duration and resumes automatically when the workflow completes, fails, or is stopped. If the user cancels this tool call, only the wait is cancelled; the workflow continues running in the background and will still send its completion notification.`;

export function createWaitForWorkflowTool(name: "WaitForWorkflow" | "wait_for_workflow") {
    return defineTool({
        name,
        label: name,
        description: WAIT_DESCRIPTION,
        arguments: Type.Object({
            run_id: Type.String({ description: "Workflow run identifier returned by workflow." }),
        }),
        returnType: waitForWorkflowReturnSchema,
        interruptionMessage:
            "The workflow wait was cancelled by the user. The workflow is still running in the background.",
        shouldReviewInAutoMode: () => false,
        execute: async ({ run_id }, context, execution) => {
            if (context.workflows === undefined) {
                throw new Error("Workflows are unavailable in this session.");
            }
            execution.onStatus?.("Awaiting for workflow to complete");
            const run = await context.workflows.wait(run_id, execution.signal);
            if (run === undefined) throw new Error("The workflow run was not found.");
            if (run.status === "running") {
                throw new Error("The workflow wait ended before the workflow finished.");
            }
            return {
                agent_count: run.agentCount,
                ...(run.error === undefined ? {} : { error: run.error }),
                logs: Array.from(run.logs),
                name: run.name,
                ...(run.output === undefined ? {} : { output: serializeWorkflowValue(run.output) }),
                run_id,
                status: run.status,
            };
        },
        toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
        toUI: (result) => `Workflow ${result.name} ${result.status}.`,
        locks: [],
    });
}
