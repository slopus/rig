import { describe, expect, it, vi } from "vitest";

import type { ManagedSubagent } from "../../context/SubagentContext.js";
import { claudeTaskOutputTool } from "../../tools/claude/TaskOutput.js";
import { claudeTaskStopTool } from "../../tools/claude/TaskStop.js";
import { createJustBashToolHarness } from "../../../tools/testing/createJustBashToolHarness.js";

describe("Claude background-agent task tools", () => {
    it("waits for a background Agent and returns its final output", async () => {
        const harness = createJustBashToolHarness();
        let agent: ManagedSubagent = {
            description: "Inspect tests",
            path: "/root/inspect_tests",
            sessionId: "subagent-1",
            status: "running",
            taskName: "inspect_tests",
        };
        const wait = vi.fn(async () => {
            agent = {
                ...agent,
                output: "The test audit is complete.",
                status: "completed",
            };
            return { agents: [agent], timedOut: false };
        });
        harness.context.subagents = {
            canSpawn: true,
            depth: 0,
            followUp: vi.fn(),
            inspect: () => agent,
            interrupt: vi.fn(),
            list: () => [agent],
            maxDepth: 3,
            spawn: vi.fn(),
            wait,
        };

        await expect(
            harness.runTool(claudeTaskOutputTool, {
                block: true,
                task_id: "subagent-1",
                timeout: 1_000,
            }),
        ).resolves.toEqual({
            retrieval_status: "success",
            task: {
                description: "Inspect tests",
                output: "The test audit is complete.",
                status: "completed",
                task_id: "subagent-1",
                task_type: "local_agent",
            },
        });
        expect(wait).toHaveBeenCalledOnce();
    });

    it("stops a running background Agent by task name", async () => {
        const harness = createJustBashToolHarness();
        const agent: ManagedSubagent = {
            description: "Inspect tests",
            path: "/root/inspect_tests",
            sessionId: "subagent-1",
            status: "running",
            taskName: "inspect_tests",
        };
        const interrupt = vi.fn(() => ({ ...agent, status: "aborted" as const }));
        harness.context.subagents = {
            canSpawn: true,
            depth: 0,
            followUp: vi.fn(),
            inspect: () => agent,
            interrupt,
            list: () => [agent],
            maxDepth: 3,
            spawn: vi.fn(),
            wait: vi.fn(),
        };

        await expect(
            harness.runTool(claudeTaskStopTool, { task_id: "inspect_tests" }),
        ).resolves.toEqual({
            command: "Inspect tests",
            message: "The background agent was stopped.",
            task_id: "subagent-1",
            task_type: "local_agent",
        });
        expect(interrupt).toHaveBeenCalledWith("subagent-1");
    });
});
