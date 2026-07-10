import { describe, expect, it, vi } from "vitest";

import type { ManagedSubagent } from "../../agent/index.js";
import { claudeSendMessageTool } from "../claude/SendMessage.js";
import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { codexFollowupTaskTool } from "./followup_task.js";
import { codexInterruptAgentTool } from "./interrupt_agent.js";
import { codexListAgentsTool } from "./list_agents.js";
import { codexSpawnAgentTool } from "./spawn_agent.js";
import { codexWaitAgentTool } from "./wait_agent.js";

describe("Codex collaboration tools", () => {
    it("exposes background spawn and lifecycle controls", async () => {
        const harness = createJustBashToolHarness();
        const agent: ManagedSubagent = {
            description: "Inspect code",
            path: "/root/inspect_code",
            sessionId: "agent-1",
            status: "running",
            taskName: "inspect_code",
        };
        const spawn = vi.fn(async () => ({
            output: "The subagent is running in the background.",
            path: agent.path,
            sessionId: agent.sessionId,
            status: "running" as const,
            taskName: agent.taskName,
        }));
        const followUp = vi.fn(() => agent);
        const interrupt = vi.fn(() => agent);
        const list = vi.fn(() => [agent]);
        const wait = vi.fn(async () => ({ agents: [agent], timedOut: false }));
        harness.context.subagents = {
            canSpawn: true,
            depth: 0,
            followUp,
            interrupt,
            list,
            maxDepth: 3,
            spawn,
            wait,
        };

        await expect(
            codexSpawnAgentTool.execute(
                { message: "Inspect the implementation.", task_name: "inspect_code" },
                harness.context,
                { toolCallId: "tool-1" },
            ),
        ).resolves.toEqual({
            agent_id: "agent-1",
            path: "/root/inspect_code",
            task_name: "inspect_code",
        });
        expect(spawn).toHaveBeenCalledWith({
            background: true,
            description: "Inspect code",
            parentToolCallId: "tool-1",
            prompt: "Inspect the implementation.",
            taskName: "inspect_code",
        });

        expect(
            codexFollowupTaskTool.execute(
                { message: "Check the tests too.", target: "inspect_code" },
                harness.context,
                {},
            ),
        ).toEqual(agent);
        expect(followUp).toHaveBeenCalledWith("inspect_code", "Check the tests too.");
        expect(
            claudeSendMessageTool.execute(
                {
                    message: "Review the final diff.",
                    summary: "Review final changes",
                    to: "inspect_code",
                },
                harness.context,
                {},
            ),
        ).toEqual({
            message: "Review final changes: follow-up work was sent to Inspect code.",
            success: true,
            target: "/root/inspect_code",
        });
        expect(codexListAgentsTool.execute({}, harness.context, {})).toEqual({ agents: [agent] });
        expect(codexInterruptAgentTool.execute({ target: "agent-1" }, harness.context, {})).toEqual(
            agent,
        );
        await expect(
            codexWaitAgentTool.execute({ timeout_ms: 1 }, harness.context, {}),
        ).resolves.toEqual({ agents: [agent], timed_out: false });
    });
});
