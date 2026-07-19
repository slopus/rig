import { describe, expect, it } from "vitest";

import { NativeProcessManager } from "../processes/index.js";
import {
    modelAnthropicFable5,
    modelMoonshotKimiK25,
    modelOpenaiGpt55,
    modelOpenaiGpt56Sol,
    modelXaiGrok45,
    modelXaiGrokBuild,
} from "../providers/models.js";
import { createCodingAssistantAgent } from "./createCodingAssistantAgent.js";

describe("createCodingAssistantAgent", () => {
    it("creates a Codex agent with node filesystem and bash contexts", () => {
        const cwd = "/tmp/rig-app-test";
        const processManager = new NativeProcessManager();

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
        expect(runtime.agent.tools.map((tool) => tool.name)).toContain("image_gen");
    });

    it("creates a Claude SDK agent for Anthropic models", () => {
        const cwd = "/tmp/rig-app-test";
        const processManager = new NativeProcessManager();

        const runtime = createCodingAssistantAgent({
            cwd,
            modelId: modelAnthropicFable5.id,
            processManager,
        });

        expect(runtime.provider.id).toBe("claude");
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

    it("creates a Grok Build agent with the native Grok tool surface", () => {
        const runtime = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: { XAI_API_KEY: "xai-test-key" },
            modelId: modelXaiGrokBuild.id,
        });

        expect(runtime.provider.id).toBe("grok");
        expect(runtime.agent.model).toEqual(modelXaiGrokBuild);
        expect(runtime.agent.tools.map((tool) => tool.name)).toEqual([
            "run_terminal_command",
            "read_file",
            "search_replace",
            "list_dir",
            "grep",
            "get_command_or_subagent_output",
            "kill_command_or_subagent",
        ]);
    });

    it("creates a Grok agent for a curated model", () => {
        const runtime = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: { XAI_API_KEY: "xai-test-key" },
            modelId: modelXaiGrok45.id,
        });

        expect(runtime.provider.id).toBe("grok");
        expect(runtime.agent.model).toEqual(modelXaiGrok45);
        expect(runtime.agent.tools.map((tool) => tool.name)).toContain("run_terminal_command");
    });

    it("creates agents for named provider instances and applies their model filters", () => {
        const providers = {
            work_codex: {
                authFile: "/tmp/codex-work-auth.json",
                enabled: true,
                includeModels: [modelOpenaiGpt56Sol.id],
                type: "codex" as const,
            },
            work_claude: {
                configDir: "/tmp/claude-work",
                enabled: true,
                includeModels: [modelAnthropicFable5.id],
                type: "claude" as const,
            },
        };

        const codex = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            modelId: modelOpenaiGpt56Sol.id,
            providerId: "work_codex",
            providers,
        });
        const claude = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            modelId: modelAnthropicFable5.id,
            providerId: "work_claude",
            providers,
        });

        expect(codex.provider.id).toBe("work_codex");
        expect(codex.provider.models).toEqual([modelOpenaiGpt56Sol]);
        expect(claude.provider.id).toBe("work_claude");
        expect(claude.provider.models).toEqual([modelAnthropicFable5]);
    });

    it("rejects disabled provider instances", () => {
        expect(() =>
            createCodingAssistantAgent({
                cwd: "/tmp/rig-app-test",
                providerId: "codex",
                providers: {
                    codex: { enabled: false, type: "codex" },
                },
            }),
        ).toThrow("Unknown or disabled inference provider 'codex'.");
    });

    it("rejects an explicitly selected provider whose filters remove every model", () => {
        expect(() =>
            createCodingAssistantAgent({
                cwd: "/tmp/rig-app-test",
                modelId: modelOpenaiGpt56Sol.id,
                providerId: "work_codex",
                providers: {
                    work_codex: {
                        enabled: true,
                        excludeModels: [modelOpenaiGpt56Sol.id],
                        includeModels: [modelOpenaiGpt56Sol.id],
                        type: "codex",
                    },
                },
            }),
        ).toThrow("Provider 'work_codex' has no models after applying its model filters.");
    });

    it("does not fall back to the default Bedrock credential for a named instance", () => {
        expect(() =>
            createCodingAssistantAgent({
                cwd: "/tmp/rig-app-test",
                env: { AWS_BEARER_TOKEN_BEDROCK: "default-token" },
                modelId: modelOpenaiGpt56Sol.id,
                providerId: "work_bedrock",
                providers: {
                    work_bedrock: {
                        bearerTokenEnvVar: "WORK_BEDROCK_TOKEN",
                        enabled: true,
                        type: "bedrock",
                    },
                },
            }),
        ).toThrow(
            "Inference provider 'work_bedrock' requires the WORK_BEDROCK_TOKEN environment variable.",
        );
    });

    it("applies a Bedrock model-specific region override", () => {
        const runtime = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: { WORK_BEDROCK_TOKEN: "work-token" },
            modelId: modelOpenaiGpt56Sol.id,
            providerId: "work_bedrock",
            providers: {
                work_bedrock: {
                    bearerTokenEnvVar: "WORK_BEDROCK_TOKEN",
                    enabled: true,
                    modelOverrides: {
                        [modelOpenaiGpt56Sol.id]: { region: "us-east-1" },
                    },
                    region: "us-west-2",
                    type: "bedrock",
                },
            },
        });

        expect(runtime.provider.models.map((model) => model.id)).toContain(modelOpenaiGpt56Sol.id);
    });

    it("allows a Bedrock endpoint override to bypass regional availability", () => {
        const runtime = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: { WORK_BEDROCK_TOKEN: "work-token" },
            modelId: modelOpenaiGpt56Sol.id,
            providerId: "work_bedrock",
            providers: {
                work_bedrock: {
                    bearerTokenEnvVar: "WORK_BEDROCK_TOKEN",
                    enabled: true,
                    modelOverrides: {
                        [modelOpenaiGpt56Sol.id]: {
                            endpoint: "https://mantle.example/openai/v1",
                        },
                    },
                    region: "us-west-2",
                    type: "bedrock",
                },
            },
        });

        expect(runtime.provider.models.map((model) => model.id)).toContain(modelOpenaiGpt56Sol.id);
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
            resume: () => {
                throw new Error("not used");
            },
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
            "image_gen",
            "workflow",
            "wait_for_workflow",
            "workflow_status",
            "stop_workflow",
            "spawn_agent",
            "followup_task",
            "wait_agent",
            "list_agents",
            "interrupt_agent",
            "resume_agent",
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
                resume: () => {
                    throw new Error("not used");
                },
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
        expect(runtime.agent.tools.map((tool) => tool.name)).not.toContain("image_gen");
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
