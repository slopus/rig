import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it, vi } from "vitest";

import type { ManagedSubagent, SubagentContext } from "../../agent/index.js";
import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { grokWaitCommandsOrSubagentsTool } from "./wait_commands_or_subagents.js";

describe("wait_commands_or_subagents", () => {
    it("waits for a specified background command in wait_any mode", async () => {
        const harness = createJustBashToolHarness();
        let completed = false;
        void delay(20).then(() => {
            completed = true;
        });
        const readSession = vi.fn(async () => commandSnapshot(completed));
        harness.context.bash.readSession = readSession;

        const result = await grokWaitCommandsOrSubagentsTool.execute(
            { mode: "wait_any", task_ids: ["1"], timeout_ms: 500 },
            harness.context,
            {},
        );

        expect(result.results).toEqual([
            expect.objectContaining({ status: "completed", task_id: "1" }),
        ]);
        expect(readSession.mock.calls.length).toBeGreaterThan(1);
    });

    it("waits for every specified command and subagent in wait_all mode", async () => {
        const harness = createJustBashToolHarness();
        let commandCompleted = false;
        let subagentCompleted = false;
        void delay(20).then(() => {
            commandCompleted = true;
        });
        void delay(40).then(() => {
            subagentCompleted = true;
        });
        harness.context.bash.readSession = vi.fn(async () => commandSnapshot(commandCompleted));
        harness.context.subagents = subagentContext(() => subagentCompleted);

        const result = await grokWaitCommandsOrSubagentsTool.execute(
            { mode: "wait_all", task_ids: ["1", "agent-1"], timeout_ms: 500 },
            harness.context,
            {},
        );

        expect(result.results).toEqual([
            expect.objectContaining({ status: "completed", task_id: "1" }),
            expect.objectContaining({ status: "completed", task_id: "agent-1" }),
        ]);
    });
});

function commandSnapshot(completed: boolean) {
    return {
        command: "test",
        cwd: "/workspace",
        exitCode: completed ? 0 : null,
        sessionId: 1,
        status: completed ? ("completed" as const) : ("running" as const),
        stderr: "",
        stderrDelta: "",
        stdout: completed ? "done" : "",
        stdoutDelta: completed ? "done" : "",
        timedOut: false,
    };
}

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
        resume: vi.fn(agent),
        spawn: vi.fn(),
        wait: vi.fn(),
    };
}
