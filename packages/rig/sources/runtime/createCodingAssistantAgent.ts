import { createId } from "@paralleldrive/cuid2";
import { Executor, type Identity } from "@slopus/rig-execution";

import {
    Agent,
    createNodeAgentContext,
    createDockerAgentContext,
    type AgentOptions,
    type ChatHistoryContext,
    type GoalContext,
    type PermissionMode,
    type SessionSecretContext,
    type SubagentContext,
    type TaskContext,
    type UserInputContext,
} from "../agent/index.js";
import type { Message } from "../agent/types.js";
import { DEFAULT_RIG_CONFIG } from "../config/defaultConfig.js";
import { findConfiguredProvider } from "../config/findConfiguredProvider.js";
import type { ConfigProviders } from "../config/types.js";
import type { DockerExecutionConfig } from "../execution/index.js";
import { NativeProcessManager } from "../processes/index.js";
import { createExecutor } from "../executor/createExecutor.js";
import { createGymProviderFromEnvironment } from "../executor/createGymProviderFromEnvironment.js";
import { getBedrockModelRoute } from "../executor/getBedrockModelRoute.js";
import { modelOpenaiGpt56Sol } from "@slopus/rig-execution";
import type { ServiceTier } from "@slopus/rig-execution";
import { routeProviderThroughGym } from "../executor/routeProviderThroughGym.js";
import { goalTools } from "../tools/goals/index.js";
import type { WorkflowContext } from "../workflows/index.js";
import type { CodingAssistantRuntime } from "./CodingAssistantRuntime.js";
import { createDefaultInstructions } from "./createDefaultInstructions.js";
import { createGymJustBashAgentContext } from "./createGymJustBashAgentContext.js";
import { selectToolsForModel } from "./selectToolsForModel.js";
import type { DurableSkillDefinition } from "../external-skills/types.js";
import { resolveGeminiApiKey } from "../tools/webSearch/resolveGeminiApiKey.js";
import { readAgentHistoryTool } from "../tools/read_agent_history.js";
import { selectCollaborationToolsForModel } from "./selectCollaborationToolsForModel.js";

export interface CreateCodingAssistantAgentOptions {
    appendSystemPrompt?: string;
    cwd: string;
    docker?: DockerExecutionConfig;
    durableSkills?: readonly DurableSkillDefinition[];
    agentId?: string;
    apiKey?: string;
    chatHistory?: ChatHistoryContext;
    effort?: string;
    executor?: Executor;
    env?: NodeJS.ProcessEnv;
    goals?: GoalContext;
    instructions?: string;
    identity?: Identity;
    local?: boolean;
    messages?: readonly Message[];
    contextMessages?: readonly Message[];
    modelId?: string;
    providerId?: string;
    processManager?: NativeProcessManager;
    permissionMode?: PermissionMode;
    providers?: ConfigProviders;
    serviceTier?: ServiceTier;
    startDate?: string;
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
    if (options.chatHistory !== undefined) {
        context.chatHistory = options.chatHistory;
    }
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
    const nativeProvider =
        options.executor ??
        (() => {
            if (providerId === "gym") {
                const provider = createGymProviderFromEnvironment(env);
                if (provider === undefined) {
                    throw new Error("RIG_GYM_INFERENCE_URL is required for the gym provider.");
                }
                return provider;
            }
            if (providerConfig === undefined)
                throw new Error(`Unknown inference provider '${providerId}'.`);
            const result = createExecutor({
                agentContext: context,
                ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
                env,
                ...(options.identity === undefined ? {} : { identity: options.identity }),
                providers: options.providers ?? DEFAULT_RIG_CONFIG.providers,
                sessionId: agentId,
            });
            const executor = result.executor;
            if (executor === undefined) {
                const variable = result.missingCredentials.get(providerId);
                throw new Error(
                    variable === undefined
                        ? `Inference provider '${providerId}' is unavailable.`
                        : `Inference provider '${providerId}' requires the ${variable} environment variable.`,
                );
            }
            executor.selectProvider(providerId);
            return executor;
        })();
    if (nativeProvider instanceof Executor) nativeProvider.selectProvider(providerId);
    const provider = routeProviderThroughGym(nativeProvider, env);
    const model = provider.models.find((candidate) => candidate.id === modelId);
    if (model === undefined) {
        throw new Error(`Unknown model '${modelId}' for provider '${provider.id}'`);
    }
    const geminiApiKey = resolveGeminiApiKey(env);
    const baseTools = selectToolsForModel({
        ...(geminiApiKey === undefined ? {} : { geminiApiKey }),
        model,
        provider,
    });
    const collaborationTools = selectCollaborationToolsForModel({ model, provider }).filter(
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
    const availableCollaborationTools =
        options.subagents === undefined
            ? []
            : options.subagents.canSpawn
              ? collaborationTools
              : collaborationTools.filter((tool) =>
                    [
                        "followup_task",
                        "wait_agent",
                        "resume_agent",
                        "send_input",
                        "close_agent",
                        "list_agents",
                        "interrupt_agent",
                        "send_message",
                        "SendMessage",
                        "followup_subagent",
                    ].includes(tool.name),
                );
    const toolsWithoutGoals = [
        ...baseTools,
        ...(options.chatHistory === undefined ? [] : [readAgentHistoryTool]),
        ...availableCollaborationTools,
    ];
    const selectedTools =
        options.goals === undefined ? toolsWithoutGoals : [...toolsWithoutGoals, ...goalTools];
    const usesOfficialCodexBedrockPrompt =
        provider.type === "bedrock" && model.id.startsWith("openai/");
    const tools = selectedTools;
    const agentOptions: AgentOptions = {
        ...(options.appendSystemPrompt !== undefined
            ? { appendSystemPrompt: options.appendSystemPrompt }
            : {}),
        provider,
        modelId,
        context,
        id: agentId,
        ...(options.instructions !== undefined
            ? { instructions: options.instructions }
            : provider.type === "claude" || usesOfficialCodexBedrockPrompt
              ? {}
              : { instructions: createDefaultInstructions(runtimeCwd) }),
        ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
        ...(options.durableSkills !== undefined ? { durableSkills: options.durableSkills } : {}),
        ...(options.messages !== undefined ? { messages: options.messages } : {}),
        ...(options.contextMessages !== undefined
            ? { contextMessages: options.contextMessages }
            : {}),
        ...(options.startDate !== undefined ? { startDate: options.startDate } : {}),
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
        executor: provider,
    };
}
