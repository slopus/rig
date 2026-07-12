import { Type, type Static } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { serializeWorkflowValue } from "../../workflows/index.js";

const workflowStatusReturnSchema = Type.Object({
    agent_count: Type.Number(),
    error: Type.Optional(Type.String()),
    logs: Type.Array(Type.String()),
    name: Type.String(),
    output: Type.Optional(Type.String()),
    run_id: Type.String(),
    status: Type.Union([
        Type.Literal("completed"),
        Type.Literal("error"),
        Type.Literal("running"),
        Type.Literal("stopped"),
    ]),
});

export const codexWorkflowStatusTool = defineTool({
    name: "workflow_status",
    label: "workflow_status",
    description: "Read the current status and consolidated output of a workflow run.",
    arguments: Type.Object({
        run_id: Type.String({ description: "Workflow run identifier returned by workflow." }),
    }),
    returnType: workflowStatusReturnSchema,
    execute: ({ run_id }, context): Static<typeof workflowStatusReturnSchema> => {
        if (context.workflows === undefined) {
            throw new Error("Workflows are unavailable in this session.");
        }
        const run = context.workflows.get(run_id);
        if (run === undefined) throw new Error("The workflow run was not found.");
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
    toUI: (result) => `Workflow ${result.name} is ${result.status}.`,
    locks: [],
});
