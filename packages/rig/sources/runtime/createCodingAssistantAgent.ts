import { createId } from "@paralleldrive/cuid2";

import {
    Agent,
    createNodeAgentContext,
    createDockerAgentContext,
    type AgentOptions,
    type GoalContext,
    type PermissionMode,
    type SessionSecretContext,
    type SubagentContext,
    type TaskContext,
    type UserInputContext,
} from "../agent/index.js";
import type { DockerExecutionConfig } from "../execution/index.js";
import { DEFAULT_RIG_CONFIG } from "../config/defaultConfig.js";
import { findConfiguredProvider } from "../config/findConfiguredProvider.js";
import type { ConfigProviders } from "../config/types.js";
import type { WorkflowContext } from "../workflows/index.js";
import type { Message } from "../agent/types.js";
import { NativeProcessManager } from "../processes/index.js";
import { createConfiguredProvider } from "../providers/createConfiguredProvider.js";
import { createGymProviderFromEnvironment } from "../providers/createGymProviderFromEnvironment.js";
import { getBedrockModelRoute } from "../providers/getBedrockModelRoute.js";
import { modelMoonshotKimiK3, modelOpenaiGpt56Sol } from "../providers/models.js";
import type { ServiceTier } from "../providers/types.js";
import { routeProviderThroughGym } from "../providers/routeProviderThroughGym.js";
import { claudeCollaborationTools } from "../tools/claude/index.js";
import { codexCollaborationTools, createCodexImageGenerationTool } from "../tools/codex/index.js";
import { grokCollaborationTools } from "../tools/grok/index.js";
import { agentTool } from "../tools/Agent.js";
import { goalTools } from "../tools/goals/index.js";
import { kimiAgentTool, kimiGoalTools } from "../tools/kimi/index.js";
import type { CodingAssistantRuntime } from "./CodingAssistantRuntime.js";
import { createDefaultInstructions } from "./createDefaultInstructions.js";
import { createGymJustBashAgentContext } from "./createGymJustBashAgentContext.js";
import { selectToolsForModel } from "./selectToolsForModel.js";
import type { DurableSkillDefinition } from "../external-skills/types.js";

export interface CreateCodingAssistantAgentOptions {
    appendSystemPrompt?: string;
    cwd: string;
    docker?: DockerExecutionConfig;
    durableSkills?: readonly DurableSkillDefinition[];
    agentId?: string;
    apiKey?: string;
    effort?: string;
    env?: NodeJS.ProcessEnv;
    goals?: GoalContext;
    instructions?: string;
    local?: boolean;
    messages?: readonly Message[];
    contextMessages?: readonly Message[];
    modelId?: string;
    providerId?: string;
    processManager?: NativeProcessManager;
    permissionMode?: PermissionMode;
    providers?: ConfigProviders;
    serviceTier?: ServiceTier;
    secrets?: SessionSecretContext;
    subagents?: SubagentContext;
    systemPrompt?: string;
    tasks?: TaskContext;
    userInput?: UserInputContext;
    workflows?: WorkflowContext;
    workflowsEnabled?: boolean;
    sessionId?: string;
}

export function createCodingAssistantAgent(
    options: CreateCodingAssistantAgentOptions,
): CodingAssistantRuntime {
    const processManager = options.processManager ?? new NativeProcessManager();
    const agentId = options.agentId ?? createId();
    const workflowsEnabled = options.workflows !== undefined && options.workflowsEnabled !== false;
    const sharedContextOptions = {
        ...(options.goals !== undefined ? { goals: options.goals } : {}),
        ...(options.permissionMode !== undefined ? { permissionMode: options.permissionMode } : {}),
        ...(options.secrets !== undefined ? { secrets: options.secrets } : {}),
        ...(options.tasks !== undefined ? { tasks: options.tasks } : {}),
        ...(options.userInput !== undefined ? { userInput: options.userInput } : {}),
        ...(workflowsEnabled ? { workflows: options.workflows } : {}),
    };
    const context =
        process.env.RIG_GYM_RUNTIME === "just-bash"
            ? createGymJustBashAgentContext(sharedContextOptions)
            : options.docker === undefined
              ? createNodeAgentContext({
                    ...sharedContextOptions,
                    cwd: options.cwd,
                    processManager,
                })
              : createDockerAgentContext({
                    ...sharedContextOptions,
                    docker: options.docker,
                    sessionId: options.sessionId ?? options.agentId ?? "standalone",
                });
    const runtimeCwd = context.fs.cwd;
    if (options.subagents !== undefined) {
        context.subagents = options.subagents;
    }
    const modelId = options.modelId ?? modelOpenaiGpt56Sol.id;
    const providerId =
        options.providerId ??
        (modelId.startsWith("anthropic/")
            ? "claude"
            : modelId.startsWith("xai/")
              ? "grok"
              : modelId === modelMoonshotKimiK3.id
                ? "kimi"
                : modelId.startsWith("openai/")
                  ? "codex"
                  : getBedrockModelRoute(modelId) !== undefined
                    ? "bedrock"
                    : "codex");
    const providerConfig =
        providerId === "gym"
            ? undefined
            : findConfiguredProvider(options.providers ?? DEFAULT_RIG_CONFIG.providers, providerId);
    if (providerId !== "gym" && (providerConfig === undefined || !providerConfig.enabled)) {
        throw new Error(`Unknown or disabled inference provider '${providerId}'.`);
    }
    const env = options.env ?? process.env;
    const nativeProvider = (() => {
        if (providerId === "gym") {
            const provider = createGymProviderFromEnvironment(env);
            if (provider === undefined) {
                throw new Error("RIG_GYM_INFERENCE_URL is required for the gym provider.");
            }
            return provider;
        }
        if (providerConfig === undefined)
            throw new Error(`Unknown inference provider '${providerId}'.`);
        const result = createConfiguredProvider({
            agentContext: context,
            ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
            config: providerConfig,
            env,
            id: providerId,
            sessionId: agentId,
        });
        if (result.status === "missing_credential") {
            throw new Error(
                `Inference provider '${providerId}' requires the ${result.variable} environment variable.`,
            );
        }
        return result.provider;
    })();
    const provider = routeProviderThroughGym(nativeProvider, env);
    const model = provider.models.find((candidate) => candidate.id === modelId);
    if (model === undefined) {
        throw new Error(`Unknown model '${modelId}' for provider '${provider.id}'`);
    }
    const toolProfile = provider.toolProfile(model);
    const usesClaudeTools = toolProfile === "claude";
    const usesCodexTools = toolProfile === "codex";
    const usesGrokTools = toolProfile === "grok";
    const usesKimiTools = toolProfile === "kimi";
    const selectedBaseTools = selectToolsForModel({ model, provider });
    const baseTools =
        usesCodexTools && provider.generateImage !== undefined
            ? [...selectedBaseTools, createCodexImageGenerationTool(provider.generateImage)]
            : selectedBaseTools;
    const collaborationTools = (
        usesCodexTools
            ? codexCollaborationTools
            : usesGrokTools
              ? grokCollaborationTools
              : usesKimiTools
                ? [kimiAgentTool]
                : usesClaudeTools
                  ? [agentTool, ...claudeCollaborationTools]
                  : [agentTool]
    ).filter(
        (tool) =>
            workflowsEnabled ||
            ![
                "workflow",
                "wait_for_workflow",
                "workflow_status",
                "stop_workflow",
                "Workflow",
                "WaitForWorkflow",
            ].includes(tool.name),
    );
    const toolsWithoutGoals =
        options.subagents?.canSpawn !== true
            ? [...baseTools]
            : [...baseTools, ...collaborationTools];
    const tools =
        options.goals === undefined
            ? toolsWithoutGoals
            : [...toolsWithoutGoals, ...(usesKimiTools ? kimiGoalTools : goalTools)];
    const agentOptions: AgentOptions = {
        ...(options.appendSystemPrompt !== undefined
            ? { appendSystemPrompt: options.appendSystemPrompt }
            : {}),
        provider,
        modelId,
        context,
        id: agentId,
        instructions: options.instructions ?? createDefaultInstructions(runtimeCwd),
        ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
        ...(options.durableSkills !== undefined ? { durableSkills: options.durableSkills } : {}),
        ...(options.messages !== undefined ? { messages: options.messages } : {}),
        ...(options.contextMessages !== undefined
            ? { contextMessages: options.contextMessages }
            : {}),
        tools,
        printToConsole: false,
    };
    if (options.effort !== undefined) {
        agentOptions.effort = options.effort;
    }
    if (options.serviceTier !== undefined) {
        agentOptions.serviceTier = options.serviceTier;
    }

    return {
        agent: new Agent(agentOptions),
        context,
        cwd: runtimeCwd,
        processManager,
        provider,
    };
}
