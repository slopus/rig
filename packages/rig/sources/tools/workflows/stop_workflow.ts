import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";

export const codexStopWorkflowTool = defineTool({
    name: "stop_workflow",
    label: "stop_workflow",
    description: "Stop a running workflow and its active subagents.",
    arguments: Type.Object({
        run_id: Type.String({ description: "Workflow run identifier returned by workflow." }),
    }),
    returnType: Type.Object({
        name: Type.String(),
        run_id: Type.String(),
        status: Type.Literal("stopped"),
    }),
    execute: ({ run_id }, context) => {
        if (context.workflows === undefined) {
            throw new Error("Workflows are unavailable in this session.");
        }
        const run = context.workflows.stop(run_id);
        if (run === undefined) throw new Error("The workflow run was not found.");
        if (run.status !== "stopped") throw new Error("The workflow is no longer running.");
        return { name: run.name, run_id, status: "stopped" as const };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) => `Stopped workflow ${result.name}.`,
    locks: [],
});
