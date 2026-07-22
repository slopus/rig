import { describe, expect, it } from "vitest";

import { NativeProcessManager } from "../processes/index.js";
import {
    modelAnthropicFable5,
    modelMoonshotKimiK3,
    modelOpenaiGpt56Sol,
    modelZaiGlm5,
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
            env: {},
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

    it("automatically enables universal Gemini tools from the daemon environment", () => {
        const runtime = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: { GEMINI_API_KEY: "gemini-key" },
        });

        expect(runtime.agent.tools.map((tool) => tool.name)).toEqual(
            expect.arrayContaining([
                "gemini_search",
                "gemini_generate_image",
                "gemini_generate_music",
                "gemini_analyze_media",
            ]),
        );
    });

    it("creates a Claude SDK agent for Anthropic models", () => {
        const cwd = "/tmp/rig-app-test";
        const processManager = new NativeProcessManager();

        const runtime = createCodingAssistantAgent({
            cwd,
            env: {},
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

    it("adds X search when an enabled Grok provider can run Grok 4.5", () => {
        const runtime = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: { XAI_API_KEY: "xai-test-key" },
            providers: {
                codex: { enabled: true, type: "codex" },
                grok: { enabled: true, type: "grok" },
            },
        });

        expect(runtime.agent.tools.map((tool) => tool.name)).toContain("x_search");
    });

    it("omits X search when Grok is disabled or Grok 4.5 is filtered out", () => {
        const disabled = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            providers: {
                codex: { enabled: true, type: "codex" },
                grok: { enabled: false, type: "grok" },
            },
        });
        const filtered = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: { XAI_API_KEY: "xai-test-key" },
            providers: {
                codex: { enabled: true, type: "codex" },
                grok: {
                    enabled: true,
                    includeModels: [modelXaiGrokBuild.id],
                    type: "grok",
                },
            },
        });

        expect(disabled.agent.tools.map((tool) => tool.name)).not.toContain("x_search");
        expect(filtered.agent.tools.map((tool) => tool.name)).not.toContain("x_search");
    });

    it("uses an eligible named Grok provider when the default filters out Grok 4.5", () => {
        const runtime = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: { XAI_API_KEY: "xai-test-key" },
            providers: {
                codex: { enabled: true, type: "codex" },
                grok: {
                    enabled: true,
                    includeModels: [modelXaiGrokBuild.id],
                    type: "grok",
                },
                research_grok: {
                    enabled: true,
                    includeModels: [modelXaiGrok45.id],
                    type: "grok",
                },
            },
        });

        expect(runtime.agent.tools.map((tool) => tool.name)).toContain("x_search");
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

    it("keeps Rig extensions out of Codex's reserved collaboration namespace", () => {
        const runtime = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            modelId: modelOpenaiGpt56Sol.id,
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
        });

        expect(
            runtime.agent.tools
                .filter((tool) => tool.codeMode?.namespace === "collaboration")
                .map((tool) => tool.name),
        ).toEqual(["followup_task", "interrupt_agent", "list_agents", "spawn_agent", "wait_agent"]);
        expect(
            runtime.agent.tools
                .filter((tool) => tool.codeMode?.namespace === "rig")
                .map((tool) => tool.name),
        ).toEqual([
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

        expect(
            parent.agent.tools
                .filter((tool) => tool.codeMode?.namespace === undefined)
                .map((tool) => tool.name),
        ).toEqual([
            "exec_command",
            "write_stdin",
            "apply_patch",
            "view_image",
            "update_plan",
            "request_user_input",
        ]);
        expect(
            parent.agent.tools
                .filter((tool) => tool.codeMode?.namespace === "collaboration")
                .map((tool) => tool.name),
        ).toEqual(["followup_task", "interrupt_agent", "list_agents", "spawn_agent", "wait_agent"]);
        expect(
            parent.agent.tools
                .filter((tool) => tool.codeMode?.namespace === "rig")
                .map((tool) => tool.name),
        ).toEqual([
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
        expect(deepest.agent.tools.map((tool) => tool.name)).toEqual(
            expect.arrayContaining([
                "followup_task",
                "wait_agent",
                "list_agents",
                "interrupt_agent",
                "resume_agent",
            ]),
        );
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

        const claudeDeepest = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            modelId: modelAnthropicFable5.id,
            subagents: { ...controls, canSpawn: false, depth: 3 },
            workflows,
        });
        expect(claudeDeepest.agent.tools.map((tool) => tool.name)).toContain("SendMessage");
        expect(claudeDeepest.agent.tools.map((tool) => tool.name)).not.toContain("Agent");
        expect(claudeDeepest.agent.tools.map((tool) => tool.name)).not.toContain("Workflow");

        const grokParent = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: { XAI_API_KEY: "xai-test-key" },
            modelId: modelXaiGrok45.id,
            subagents: { ...controls, canSpawn: true },
        });
        expect(grokParent.agent.tools.map((tool) => tool.name)).toContain("spawn_subagent");
        expect(grokParent.agent.tools.map((tool) => tool.name)).toContain("followup_subagent");

        const grokDeepest = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: { XAI_API_KEY: "xai-test-key" },
            modelId: modelXaiGrok45.id,
            subagents: { ...controls, canSpawn: false, depth: 3 },
        });
        expect(grokDeepest.agent.tools.map((tool) => tool.name)).toContain("followup_subagent");
        expect(grokDeepest.agent.tools.map((tool) => tool.name)).not.toContain("spawn_subagent");

        const kimiParent = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: { KIMI_API_KEY: "kimi-test-key" },
            modelId: modelMoonshotKimiK3.id,
            subagents: { ...controls, canSpawn: true },
        });
        expect(kimiParent.agent.tools.map((tool) => tool.name)).toContain("Agent");
        expect(kimiParent.agent.tools.map((tool) => tool.name)).toContain("SendMessage");
        const kimiDeepest = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: { KIMI_API_KEY: "kimi-test-key" },
            modelId: modelMoonshotKimiK3.id,
            subagents: { ...controls, canSpawn: false, depth: 3 },
        });
        expect(kimiDeepest.agent.tools.map((tool) => tool.name)).toContain("SendMessage");
        expect(kimiDeepest.agent.tools.map((tool) => tool.name)).not.toContain("Agent");

        const piParent = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: {
                AWS_BEARER_TOKEN_BEDROCK: "bedrock-token",
                AWS_REGION: "us-east-1",
            },
            modelId: modelZaiGlm5.id,
            providerId: "bedrock",
            subagents: { ...controls, canSpawn: true },
        });
        expect(piParent.agent.tools.map((tool) => tool.name)).toContain("Agent");
        expect(piParent.agent.tools.map((tool) => tool.name)).toContain("SendMessage");
        const piDeepest = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: {
                AWS_BEARER_TOKEN_BEDROCK: "bedrock-token",
                AWS_REGION: "us-east-1",
            },
            modelId: modelZaiGlm5.id,
            providerId: "bedrock",
            subagents: { ...controls, canSpawn: false, depth: 3 },
        });
        expect(piDeepest.agent.tools.map((tool) => tool.name)).toContain("SendMessage");
        expect(piDeepest.agent.tools.map((tool) => tool.name)).not.toContain("Agent");
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
        const managed = {
            description: "Test",
            path: "/root/test",
            sessionId: "test",
            status: "completed" as const,
            taskName: "test",
        };
        const runtime = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: {
                AWS_BEARER_TOKEN_BEDROCK: "bedrock-token",
                AWS_REGION: "us-east-1",
            },
            modelId: modelOpenaiGpt56Sol.id,
            providerId: "bedrock",
            subagents: {
                canSpawn: true,
                depth: 0,
                followUp: () => managed,
                interrupt: () => managed,
                list: () => [managed],
                maxDepth: 3,
                resume: () => managed,
                spawn: async () => ({ ...managed, output: "done" }),
                wait: async () => ({ agents: [managed], timedOut: false }),
            },
        });

        expect(runtime.provider.id).toBe("bedrock");
        expect(runtime.agent.model.id).toBe(modelOpenaiGpt56Sol.id);
        expect(
            runtime.agent.tools
                .filter((tool) => tool.codeMode?.namespace === undefined)
                .map((tool) => tool.name),
        ).toEqual([
            "exec_command",
            "write_stdin",
            "apply_patch",
            "view_image",
            "update_plan",
            "request_user_input",
        ]);
        expect(
            runtime.agent.tools
                .filter((tool) => tool.codeMode?.namespace === "collaboration")
                .map((tool) => tool.name),
        ).toEqual(["followup_task", "interrupt_agent", "list_agents", "spawn_agent", "wait_agent"]);
        expect(
            runtime.agent.tools
                .filter((tool) => tool.codeMode?.namespace === "rig")
                .map((tool) => tool.name),
        ).toEqual([
            "spawn_agent",
            "followup_task",
            "wait_agent",
            "list_agents",
            "interrupt_agent",
            "resume_agent",
        ]);
    });

    it("uses provider-neutral tools for Bedrock GLM models", () => {
        const runtime = createCodingAssistantAgent({
            cwd: "/tmp/rig-app-test",
            env: {
                AWS_BEARER_TOKEN_BEDROCK: "bedrock-token",
                AWS_REGION: "us-east-1",
            },
            modelId: modelZaiGlm5.id,
            providerId: "bedrock",
        });

        expect(runtime.provider.id).toBe("bedrock");
        expect(runtime.agent.model.id).toBe(modelZaiGlm5.id);
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
