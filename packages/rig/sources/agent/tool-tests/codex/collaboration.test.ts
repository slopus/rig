import { describe, expect, it, vi } from "vitest";
import { Value } from "@sinclair/typebox/value";

import type { ManagedSubagent, SpawnSubagentRequest } from "../../index.js";
import { claudeSendMessageTool } from "../../../tools/claude/SendMessage.js";
import { createJustBashToolHarness } from "../../../tools/testing/createJustBashToolHarness.js";
import { assembleCodexTools } from "../../tools/codex/assembleCodexTools.js";
import { codexV1SpawnAgentTool } from "../../tools/codex/v1/spawn_agent.js";
import { codexFollowupTaskTool } from "../../tools/codex/v2/followup_task.js";
import { codexInterruptAgentTool } from "../../tools/codex/v2/interrupt_agent.js";
import { codexListAgentsTool } from "../../tools/codex/v2/list_agents.js";
import { codexSendMessageTool } from "../../tools/codex/v2/send_message.js";
import { codexSpawnAgentTool } from "../../tools/codex/v2/spawn_agent.js";
import { codexWaitAgentTool } from "../../tools/codex/v2/wait_agent.js";

describe("Codex collaboration tools", () => {
    it("selects plaintext v1 for Bedrock and encrypted v2 for Codex Cloud", () => {
        const collaboration = assembleCodexTools("openai/gpt-5.6-sol", "codex").filter(
            (tool) => tool.namespace?.name === "collaboration",
        );
        expect(collaboration.map((tool) => tool.name)).toEqual([
            "spawn_agent",
            "followup_task",
            "send_message",
            "wait_agent",
            "list_agents",
            "interrupt_agent",
        ]);

        const bedrock = assembleCodexTools("openai/gpt-5.6-sol", "bedrock").filter(
            (tool) => tool.namespace?.name === "multi_agent_v1",
        );
        expect(bedrock.map((tool) => tool.name)).toEqual([
            "close_agent",
            "resume_agent",
            "send_input",
            "spawn_agent",
            "wait_agent",
        ]);
    });

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
                {
                    fork_turns: "none",
                    message: "Inspect the implementation.",
                    model: "anthropic/claude-sonnet-4.6",
                    reasoning_effort: "high",
                    task_name: "inspect_code",
                },
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
            contextMode: "task",
            description: "Inspect code",
            effort: "high",
            modelId: "anthropic/claude-sonnet-4.6",
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
                    effort: "low",
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
        expect(followUp).toHaveBeenLastCalledWith("inspect_code", "Review the final diff.", "low");
        expect(codexListAgentsTool.execute({}, harness.context, {})).toEqual({ agents: [agent] });
        expect(codexInterruptAgentTool.execute({ target: "agent-1" }, harness.context, {})).toEqual(
            agent,
        );
        await expect(
            codexWaitAgentTool.execute({ timeout_ms: 300_000 }, harness.context, {}),
        ).resolves.toEqual({ agents: [agent], timed_out: false });
        expect(Value.Check(codexWaitAgentTool.arguments, { timeout_ms: 300_000 })).toBe(true);
        expect(Value.Check(codexWaitAgentTool.arguments, { timeout_ms: 3_600_001 })).toBe(false);
        expect(codexWaitAgentTool.steerable).toBe(true);
    });

    it("passes native Codex collaboration messages through encrypted envelopes", async () => {
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
        const sendMessage = vi.fn(() => agent);
        harness.context.subagents = {
            canSpawn: true,
            depth: 0,
            encryptedMessages: true,
            followUp,
            interrupt: vi.fn(),
            list: vi.fn(() => [agent]),
            maxDepth: 3,
            sendMessage,
            spawn,
            wait: vi.fn(async () => ({ agents: [agent], timedOut: false })),
        };

        await codexSpawnAgentTool.execute(
            {
                fork_turns: "none",
                message: "opaque-spawn-ciphertext",
                task_name: "inspect_code",
            },
            harness.context,
            { toolCallId: "tool-1" },
        );
        expect(spawn).toHaveBeenCalledWith(
            expect.objectContaining({
                encryptedPrompt: "opaque-spawn-ciphertext",
                prompt: "",
            }),
        );

        codexFollowupTaskTool.execute(
            { message: "opaque-followup-ciphertext", target: "inspect_code" },
            harness.context,
            {},
        );
        expect(followUp).toHaveBeenCalledWith(
            "inspect_code",
            "",
            undefined,
            "opaque-followup-ciphertext",
        );

        codexSendMessageTool.execute(
            { message: "opaque-message-ciphertext", target: "inspect_code" },
            harness.context,
            {},
        );
        expect(sendMessage).toHaveBeenCalledWith("inspect_code", "", "opaque-message-ciphertext");
    });

    it("passes Bedrock v1 spawn messages to subagents as plaintext", async () => {
        const harness = createJustBashToolHarness();
        let observedRequest: SpawnSubagentRequest | undefined;
        const spawn = vi.fn(async (request: SpawnSubagentRequest) => {
            observedRequest = request;
            return {
                output: "The subagent is running in the background.",
                path: "/root/delegated_task",
                sessionId: "agent-1",
                status: "running" as const,
                taskName: "delegated_task",
            };
        });
        harness.context.subagents = {
            canSpawn: true,
            depth: 0,
            encryptedMessages: false,
            followUp: vi.fn(),
            interrupt: vi.fn(),
            list: vi.fn(() => []),
            maxDepth: 3,
            spawn,
            wait: vi.fn(async () => ({ agents: [], timedOut: false })),
        };

        await codexV1SpawnAgentTool.execute(
            {
                fork_context: false,
                message: "Inspect the Bedrock implementation.",
            },
            harness.context,
            { toolCallId: "tool-v1" },
        );
        expect(spawn).toHaveBeenCalledWith(
            expect.objectContaining({
                contextMode: "task",
                prompt: "Inspect the Bedrock implementation.",
            }),
        );
        expect(observedRequest).not.toHaveProperty("encryptedPrompt");
    });
});
