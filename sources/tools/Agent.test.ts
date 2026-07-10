import { describe, expect, it, vi } from "vitest";

import { createJustBashToolHarness } from "./testing/createJustBashToolHarness.js";
import { agentTool } from "./Agent.js";

describe("Agent tool", () => {
    it("starts a managed subagent and forwards the tool call identity", async () => {
        const harness = createJustBashToolHarness();
        const spawn = vi.fn(async () => ({
            output: "The delegated task is complete.",
            path: "/root/inspect_tests",
            sessionId: "subagent-1",
            status: "completed" as const,
            taskName: "inspect_tests",
        }));
        harness.context.subagents = {
            canSpawn: true,
            depth: 0,
            followUp: vi.fn(),
            interrupt: vi.fn(),
            list: () => [],
            maxDepth: 3,
            spawn,
            wait: async () => ({ agents: [], timedOut: false }),
        };

        const result = await agentTool.execute(
            { description: "Inspect the tests", prompt: "Review the test suite." },
            harness.context,
            { toolCallId: "tool-1" },
        );

        expect(result).toMatchObject({ sessionId: "subagent-1", status: "completed" });
        expect(spawn).toHaveBeenCalledWith(
            {
                description: "Inspect the tests",
                parentToolCallId: "tool-1",
                prompt: "Review the test suite.",
            },
            undefined,
        );
    });

    it("rejects spawning after the maximum depth", async () => {
        const harness = createJustBashToolHarness();
        harness.context.subagents = {
            canSpawn: false,
            depth: 3,
            followUp: vi.fn(),
            interrupt: vi.fn(),
            list: () => [],
            maxDepth: 3,
            spawn: vi.fn(),
            wait: async () => ({ agents: [], timedOut: false }),
        };

        await expect(
            agentTool.execute(
                { description: "Go deeper", prompt: "Start another agent." },
                harness.context,
                {},
            ),
        ).rejects.toThrow("maximum subagent depth");
    });

    it("launches a background agent without waiting for its final response", async () => {
        const harness = createJustBashToolHarness();
        const spawn = vi.fn(async () => ({
            output: "The subagent is running in the background.",
            path: "/root/inspect_tests",
            sessionId: "subagent-1",
            status: "running" as const,
            taskName: "inspect_tests",
        }));
        harness.context.subagents = {
            canSpawn: true,
            depth: 0,
            followUp: vi.fn(),
            interrupt: vi.fn(),
            list: () => [],
            maxDepth: 3,
            spawn,
            wait: async () => ({ agents: [], timedOut: false }),
        };

        await expect(
            agentTool.execute(
                {
                    description: "Inspect the tests",
                    prompt: "Review the test suite.",
                    run_in_background: true,
                },
                harness.context,
                { toolCallId: "tool-1" },
            ),
        ).resolves.toEqual({
            agentId: "subagent-1",
            description: "Inspect the tests",
            path: "/root/inspect_tests",
            prompt: "Review the test suite.",
            status: "async_launched",
            taskName: "inspect_tests",
        });
        expect(spawn).toHaveBeenCalledWith(
            expect.objectContaining({ background: true }),
            undefined,
        );
    });

    it("reports a failed child as a failed tool call", async () => {
        const harness = createJustBashToolHarness();
        harness.context.subagents = {
            canSpawn: true,
            depth: 0,
            followUp: vi.fn(),
            interrupt: vi.fn(),
            list: () => [],
            maxDepth: 3,
            spawn: async () => ({
                output: "The delegated check failed.",
                path: "/root/run_check",
                sessionId: "subagent-1",
                status: "error",
                taskName: "run_check",
            }),
            wait: async () => ({ agents: [], timedOut: false }),
        };

        await expect(
            agentTool.execute(
                { description: "Run the check", prompt: "Run the delegated check." },
                harness.context,
                {},
            ),
        ).rejects.toThrow("The delegated check failed");
    });
});
