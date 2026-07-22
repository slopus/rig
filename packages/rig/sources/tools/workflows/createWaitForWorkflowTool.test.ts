import { describe, expect, it, vi } from "vitest";

import type { WorkflowRun } from "../../workflows/WorkflowContext.js";
import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { createWaitForWorkflowTool } from "./createWaitForWorkflowTool.js";

describe("createWaitForWorkflowTool", () => {
    it("reports a natural waiting status", async () => {
        const harness = createJustBashToolHarness();
        const run: WorkflowRun = {
            agentCount: 1,
            code: "export default 1",
            description: "Test workflow",
            finishedAt: 2,
            logs: [],
            name: "Test workflow",
            output: 1,
            runId: "run-1",
            startedAt: 1,
            status: "completed",
            taskId: "task-1",
        };
        harness.context.workflows = {
            get: vi.fn(),
            launch: vi.fn(),
            stop: vi.fn(),
            wait: vi.fn(async () => run),
        };
        const onStatus = vi.fn();

        await createWaitForWorkflowTool("wait_for_workflow").execute(
            { run_id: run.runId },
            harness.context,
            { onStatus },
        );

        expect(onStatus).toHaveBeenCalledWith("Waiting for the workflow to complete");
        expect(createWaitForWorkflowTool("wait_for_workflow").steerable).toBe(true);
    });
});
