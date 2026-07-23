import { setTimeout as delay } from "node:timers/promises";

import { Value } from "@sinclair/typebox/value";
import { describe, expect, it, vi } from "vitest";

import type { ManagedSubagent, SubagentContext } from "../../agent/index.js";
import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { grokGetCommandOrSubagentOutputTool } from "./get_command_or_subagent_output.js";

describe("get_command_or_subagent_output", () => {
    it("waits for subagents with a positive timeout and is steerable", async () => {
        const harness = createJustBashToolHarness();
        let completed = false;
        void delay(20).then(() => {
            completed = true;
        });
        harness.context.subagents = subagentContext(() => completed);

        const result = await grokGetCommandOrSubagentOutputTool.execute(
            { task_ids: ["agent-1"], timeout_ms: 500 },
            harness.context,
            {},
        );

        expect(result.results).toEqual([
            expect.objectContaining({ status: "completed", task_id: "agent-1" }),
        ]);
        expect(grokGetCommandOrSubagentOutputTool.steerable).toBe(true);
        expect(
            Value.Check(grokGetCommandOrSubagentOutputTool.arguments, {
                task_ids: ["agent-1"],
                timeout_ms: 3_600_001,
            }),
        ).toBe(false);
    });

    it("stops a blocking read when its execution signal is aborted", async () => {
        const harness = createJustBashToolHarness();
        harness.context.subagents = subagentContext(() => false);
        const controller = new AbortController();
        const reading = grokGetCommandOrSubagentOutputTool.execute(
            { task_ids: ["agent-1"], timeout_ms: 500 },
            harness.context,
            { signal: controller.signal },
        );

        controller.abort();

        await expect(reading).rejects.toThrow("cancelled");
    });

    it("rejects task lists that normalize to no IDs", async () => {
        const harness = createJustBashToolHarness();

        await expect(
            grokGetCommandOrSubagentOutputTool.execute(
                { task_ids: ["  "], timeout_ms: 0 },
                harness.context,
                {},
            ),
        ).rejects.toThrow("at least one non-empty task ID");
    });
});

function subagentContext(completed: () => boolean): SubagentContext {
    const agent = (): ManagedSubagent => ({
        description: "Test subagent",
        path: "/root/test_subagent",
        sessionId: "agent-1",
        status: completed() ? "completed" : "running",
        taskName: "test_subagent",
    });
    return {
        canSpawn: true,
        depth: 0,
        followUp: vi.fn(agent),
        interrupt: vi.fn(agent),
        list: vi.fn(() => [agent()]),
        maxDepth: 3,
        spawn: vi.fn(),
        wait: vi.fn(),
    };
}
