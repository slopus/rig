/* eslint-disable no-control-regex -- Tests intentionally strip terminal ANSI controls. */
import { describe, expect, it, vi } from "vitest";

import type { SubagentSummary } from "../protocol/index.js";
import type { WorkflowRun } from "../workflows/index.js";
import { applyWorkflowRunUpdate } from "./applyWorkflowRunUpdate.js";
import { createWorkflowMonitor } from "./createWorkflowMonitor.js";

describe("createWorkflowMonitor", () => {
    it("opens a workflow and renders live completion updates", () => {
        let workflows: readonly WorkflowRun[] = [runningWorkflow()];
        const onCancel = vi.fn();
        const monitor = createWorkflowMonitor({
            getSubagents: () => [],
            getWorkflows: () => workflows,
            now: () => 6_000,
            onCancel,
            onStop: vi.fn(),
        });

        expect(render(monitor)).toContain("1 active · Updates live");
        expect(render(monitor)).toContain("Live monitor  Running · 1 agent · Inspect");
        expect(monitor.render(100).every((line) => line.startsWith("\x1b[48;5;235m\x1b[39m"))).toBe(
            true,
        );
        expect(monitor.render(100).join("\n")).not.toContain("\x1b[48;5;236m");

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
            getSubagents: () => [],
            getWorkflows: () => [runningWorkflow()],
            onCancel: vi.fn(),
            onStop,
        });

        monitor.handleInput?.("\r");
        monitor.handleInput?.("s");

        expect(onStop).toHaveBeenCalledWith("run-1");
    });

    it("opens workflow code and every launched agent", () => {
        const monitor = createWorkflowMonitor({
            getSubagents: () => workflowAgents(),
            getWorkflows: () => [runningWorkflow()],
            onCancel: vi.fn(),
            onStop: vi.fn(),
        });

        monitor.handleInput?.("\r");
        expect(render(monitor)).toContain("View workflow code");
        expect(render(monitor)).toContain("Agent 1  Completed · Inspect imports");
        expect(render(monitor)).toContain("Agent 2  Running · Check tests");

        monitor.handleInput?.("\r");
        expect(render(monitor)).toContain("Workflow code");
        expect(render(monitor)).toContain('phase("Inspect")');
        expect(render(monitor)).toContain('agent("Return the result")');

        monitor.handleInput?.("\x1b");
        monitor.handleInput?.("\x1b[B");
        monitor.handleInput?.("\r");
        expect(render(monitor)).toContain("Workflow agent");
        expect(render(monitor)).toContain("Incoming prompt");
        expect(render(monitor)).toContain("Inspect imports carefully.");
        expect(render(monitor)).toContain("Latest message");
        expect(render(monitor)).toContain("Imports are correct.");
    });

    it("scrolls long workflow code without leaving the code view", () => {
        const workflow = {
            ...runningWorkflow(),
            code: Array.from({ length: 20 }, (_, index) => `line_${index + 1}`).join("\n"),
        };
        const monitor = createWorkflowMonitor({
            getSubagents: () => [],
            getWorkflows: () => [workflow],
            onCancel: vi.fn(),
            onStop: vi.fn(),
        });

        monitor.handleInput?.("\r");
        monitor.handleInput?.("\r");
        expect(render(monitor)).toContain("Lines 1-14 of 20");
        expect(render(monitor)).not.toContain("line_15");

        monitor.handleInput?.("\x1b[B");
        expect(render(monitor)).toContain("Lines 2-15 of 20");
        expect(render(monitor)).toContain("line_15");
    });
});

function render(component: ReturnType<typeof createWorkflowMonitor>): string {
    return component.render(100).join("\n").replaceAll(new RegExp("\\x1b\\[[0-9;]*m", "gu"), "");
}

function runningWorkflow(): WorkflowRun {
    return {
        agentCount: 1,
        code: ['phase("Inspect")', 'agent("Return the result")'].join("\n"),
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

function workflowAgents(): SubagentSummary[] {
    return [
        {
            agentId: "agent-1",
            createdAt: 2_000,
            depth: 1,
            description: "Inspect imports",
            id: "session-1",
            latestText: "Imports are correct.",
            modelId: "openai/gym",
            parentSessionId: "parent",
            prompt: "Inspect imports carefully.",
            status: "completed",
            taskName: "workflow_run-1_1",
            updatedAt: 3_000,
        },
        {
            agentId: "agent-2",
            createdAt: 2_000,
            depth: 1,
            description: "Check tests",
            id: "session-2",
            modelId: "openai/gym",
            parentSessionId: "parent",
            prompt: "Check the tests carefully.",
            status: "running",
            taskName: "workflow_run-1_2",
            updatedAt: 3_000,
        },
    ];
}
