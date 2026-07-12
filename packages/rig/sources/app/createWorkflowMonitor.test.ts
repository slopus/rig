import { describe, expect, it, vi } from "vitest";

import type { WorkflowRun } from "../workflows/index.js";
import { applyWorkflowRunUpdate } from "./applyWorkflowRunUpdate.js";
import { createWorkflowMonitor } from "./createWorkflowMonitor.js";

describe("createWorkflowMonitor", () => {
    it("opens a workflow and renders live completion updates", () => {
        let workflows: readonly WorkflowRun[] = [runningWorkflow()];
        const onCancel = vi.fn();
        const monitor = createWorkflowMonitor({
            getWorkflows: () => workflows,
            now: () => 6_000,
            onCancel,
            onStop: vi.fn(),
        });

        expect(render(monitor)).toContain("1 active · Updates live");
        expect(render(monitor)).toContain("Live monitor  Running · 1 agent · Inspect");

        monitor.handleInput?.("\r");
        expect(render(monitor)).toContain("Inspect one monitored target");
        expect(render(monitor)).toContain("Current phase");

        workflows = applyWorkflowRunUpdate(workflows, {
            finishedAt: 7_000,
            output: { result: "MONITORED_CHILD_RESULT" },
            runId: "run-1",
            status: "completed",
        });

        expect(render(monitor)).toContain("Completed · 1 agent · 6s");
        expect(render(monitor)).toContain("MONITORED_CHILD_RESULT");

        monitor.handleInput?.("\x1b");
        monitor.handleInput?.("\x1b");
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it("stops the open running workflow", () => {
        const onStop = vi.fn();
        const monitor = createWorkflowMonitor({
            getWorkflows: () => [runningWorkflow()],
            onCancel: vi.fn(),
            onStop,
        });

        monitor.handleInput?.("\r");
        monitor.handleInput?.("s");

        expect(onStop).toHaveBeenCalledWith("run-1");
    });
});

function render(component: ReturnType<typeof createWorkflowMonitor>): string {
    return component
        .render(100)
        .join("\n")
        .replaceAll(/\x1b\[[0-9;]*m/gu, "");
}

function runningWorkflow(): WorkflowRun {
    return {
        agentCount: 1,
        description: "Inspect one monitored target",
        logs: ["Phase: Inspect"],
        name: "live-monitor",
        phase: "Inspect",
        runId: "run-1",
        startedAt: 1_000,
        status: "running",
        taskId: "workflow:run-1",
    };
}
