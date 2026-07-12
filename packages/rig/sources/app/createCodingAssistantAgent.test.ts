import { describe, expect, it } from "vitest";

import { NativeProxessManager } from "../processes/index.js";
import {
    modelAnthropicFable5,
    modelMoonshotKimiK25,
    modelOpenaiGpt55,
    modelOpenaiGpt56Sol,
} from "../providers/models.js";
import { createCodingAssistantAgent } from "./createCodingAssistantAgent.js";

describe("createCodingAssistantAgent", () => {
    it("creates a Codex agent with node filesystem and bash contexts", () => {
        const cwd = "/tmp/rig-app-test";
        const processManager = new NativeProxessManager();

        const runtime = createCodingAssistantAgent({
            cwd,
            effort: "medium",
            processManager,
        });

        expect(runtime.cwd).toBe(cwd);
        expect(runtime.processManager).toBe(processManager);
        expect(runtime.provider.id).toBe("codex");
        expect(runtime.agent.model.id).toBe(modelOpenaiGpt56Sol.id);
        expect(runtime.context.fs.cwd).toBe(cwd);
        expect(runtime.context.bash.cwd).toBe(cwd);
        expect(runtime.agent.snapshot().instructions).toContain(cwd);
        expect(runtime.agent.snapshot().effort).toBe("medium");
    });

    it("creates a Claude SDK agent for Anthropic models", () => {
        const cwd = "/tmp/rig-app-test";
        const processManager = new NativeProxessManager();

        const runtime = createCodingAssistantAgent({
            cwd,
            modelId: modelAnthropicFable5.id,
            processManager,
        });

        expect(runtime.provider.id).toBe("claude-sdk");
        expect(runtime.agent.model.id).toBe(modelAnthropicFable5.id);
        expect(runtime.agent.tools.map((tool) => tool.name)).toEqual([
            "TaskOutput",
            "Bash",
            "Read",
            "Edit",
            "Write",
            "Glob",
            "Grep",
            "TaskCreate",
            "TaskGet",
            "TaskUpdate",
            "TaskList",
            "WebFetch",
            "WebSearch",
            "TaskStop",
            "AskUserQuestion",
        ]);
    });

    it("adds provider-neutral goal tools when the session supports goals", () => {
        const currentGoal = {
            createdAt: 1,
            objective: "Finish the feature",
            status: "active" as const,
            updatedAt: 1,
        };
        const runtime = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            goals: {
                create: () => currentGoal,
                get: () => currentGoal,
                update: (status) => ({ ...currentGoal, status }),
            },
            modelId: modelAnthropicFable5.id,
        });

        expect(runtime.agent.tools.map((tool) => tool.name)).toEqual(
            expect.arrayContaining(["create_goal", "get_goal", "update_goal"]),
        );
    });

    it("exposes the Agent tool only while another nested level is available", () => {
        const spawn = async () => ({
            output: "done",
            path: "/root/test",
            sessionId: "subagent-1",
            status: "completed" as const,
            taskName: "test",
        });
        const controls = {
            depth: 0,
            followUp: () => {
                throw new Error("not used");
            },
            interrupt: () => {
                throw new Error("not used");
            },
            list: () => [],
            maxDepth: 3,
            spawn,
            wait: async () => ({ agents: [], timedOut: false }),
        };
        const workflows = {
            get: () => undefined,
            launch: () => {
                throw new Error("not used");
            },
            stop: () => undefined,
            wait: async () => undefined,
        };
        const parent = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            subagents: { ...controls, canSpawn: true },
            workflows,
        });
        const deepest = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            subagents: { ...controls, canSpawn: false, depth: 3 },
        });

        expect(parent.agent.tools.map((tool) => tool.name)).toEqual([
            "exec_command",
            "write_stdin",
            "apply_patch",
            "view_image",
            "update_plan",
            "request_user_input",
            "workflow",
            "wait_for_workflow",
            "workflow_status",
            "stop_workflow",
            "spawn_agent",
            "followup_task",
            "wait_agent",
            "list_agents",
            "interrupt_agent",
        ]);
        expect(deepest.agent.tools.map((tool) => tool.name)).not.toContain("spawn_agent");
        expect(deepest.agent.tools.map((tool) => tool.name)).not.toContain("workflow");

        const claudeParent = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            modelId: modelAnthropicFable5.id,
            subagents: { ...controls, canSpawn: true },
            workflows,
        });
        expect(claudeParent.agent.tools.map((tool) => tool.name)).toContain("Agent");
        expect(claudeParent.agent.tools.map((tool) => tool.name)).toContain("SendMessage");
        expect(claudeParent.agent.tools.map((tool) => tool.name)).toContain("Workflow");
        expect(claudeParent.agent.tools.map((tool) => tool.name)).toContain("WaitForWorkflow");
        expect(claudeParent.agent.tools.map((tool) => tool.name)).not.toContain("spawn_agent");
    });

    it("omits workflow tools when workflow support is disabled", () => {
        const runtime = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            subagents: {
                canSpawn: true,
                depth: 0,
                followUp: () => {
                    throw new Error("not used");
                },
                interrupt: () => {
                    throw new Error("not used");
                },
                list: () => [],
                maxDepth: 3,
                spawn: async () => {
                    throw new Error("not used");
                },
                wait: async () => ({ agents: [], timedOut: false }),
            },
            workflows: {
                get: () => undefined,
                launch: () => {
                    throw new Error("not used");
                },
                stop: () => undefined,
                wait: async () => undefined,
            },
            workflowsEnabled: false,
        });

        expect(runtime.agent.tools.map((tool) => tool.name)).not.toEqual(
            expect.arrayContaining([
                "workflow",
                "wait_for_workflow",
                "workflow_status",
                "stop_workflow",
            ]),
        );
        expect(runtime.agent.tools.map((tool) => tool.name)).toContain("spawn_agent");
    });

    it("creates an Amazon Bedrock agent for Bedrock Anthropic models", () => {
        const runtime = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: {
                AWS_BEARER_TOKEN_BEDROCK: "bedrock-token",
                AWS_REGION: "us-east-1",
            },
            modelId: modelAnthropicFable5.id,
            providerId: "bedrock",
        });

        expect(runtime.provider.id).toBe("bedrock");
        expect(runtime.agent.model.id).toBe(modelAnthropicFable5.id);
        expect(runtime.agent.tools.map((tool) => tool.name)).toContain("Bash");
    });

    it("uses Codex-style tools for Bedrock OpenAI models", () => {
        const runtime = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: {
                AWS_BEARER_TOKEN_BEDROCK: "bedrock-token",
                AWS_REGION: "us-east-1",
            },
            modelId: modelOpenaiGpt55.id,
            providerId: "bedrock",
        });

        expect(runtime.provider.id).toBe("bedrock");
        expect(runtime.agent.model.id).toBe(modelOpenaiGpt55.id);
        expect(runtime.agent.tools.map((tool) => tool.name)).toEqual([
            "exec_command",
            "write_stdin",
            "apply_patch",
            "view_image",
            "update_plan",
            "request_user_input",
        ]);
    });

    it("uses provider-neutral tools for Bedrock Kimi and GLM models", () => {
        const runtime = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: {
                AWS_BEARER_TOKEN_BEDROCK: "bedrock-token",
                AWS_REGION: "us-east-1",
            },
            modelId: modelMoonshotKimiK25.id,
            providerId: "bedrock",
        });

        expect(runtime.provider.id).toBe("bedrock");
        expect(runtime.agent.model.id).toBe(modelMoonshotKimiK25.id);
        expect(runtime.agent.tools.map((tool) => tool.name)).toEqual([
            "read",
            "bash",
            "edit",
            "write",
            "grep",
            "find",
            "ls",
        ]);
    });
});
