import { createId } from "@paralleldrive/cuid2";

import {
    Agent,
    createNodeAgentContext,
    createDockerAgentContext,
    type AgentOptions,
    type AnyDefinedTool,
    type GoalContext,
    type PermissionMode,
    type SubagentContext,
    type TaskContext,
    type UserInputContext,
} from "../agent/index.js";
import type { DockerExecutionConfig } from "../execution/index.js";
import { DEFAULT_RIG_CONFIG } from "../config/defaultConfig.js";
import { findConfiguredProvider } from "../config/findConfiguredProvider.js";
import type { ConfigCodexProvider, ConfigProviders } from "../config/types.js";
import type { WorkflowContext } from "../workflows/index.js";
import type { Message } from "../agent/types.js";
import { NativeProxessManager } from "../processes/index.js";
import { createBedrockProvider } from "../providers/bedrock.js";
import { createClaudeSdkProvider } from "../providers/claude-sdk.js";
import { createClaudeSessionId } from "../providers/createClaudeSessionId.js";
import { createCodexProvider, type CodexProviderOptions } from "../providers/codex.js";
import { createGymProvider } from "../providers/createGymProvider.js";
import { filterConfiguredProviderModels } from "../providers/filterConfiguredProviderModels.js";
import { getBedrockModelRoute } from "../providers/getBedrockModelRoute.js";
import { modelOpenaiGpt56Sol } from "../providers/models.js";
import { readGymContextWindow } from "../providers/readGymContextWindow.js";
import { readConfiguredBedrockBearerToken } from "../providers/readConfiguredBedrockBearerToken.js";
import type { ServiceTier } from "../providers/types.js";
import { claudeCodeTools, claudeCollaborationTools } from "../tools/claude/index.js";
import { codexCollaborationTools, codexTools } from "../tools/codex/index.js";
import { piTools } from "../tools/pi/index.js";
import { agentTool } from "../tools/Agent.js";
import { goalTools } from "../tools/goals/index.js";
import type { CodingAssistantRuntime } from "./CodingAssistantRuntime.js";
import { createDefaultInstructions } from "./createDefaultInstructions.js";

export interface CreateCodingAssistantAgentOptions {
    cwd: string;
    docker?: DockerExecutionConfig;
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
    processManager?: NativeProxessManager;
    permissionMode?: PermissionMode;
    providers?: ConfigProviders;
    serviceTier?: ServiceTier;
    subagents?: SubagentContext;
    tasks?: TaskContext;
    userInput?: UserInputContext;
    workflows?: WorkflowContext;
    workflowsEnabled?: boolean;
    sessionId?: string;
}

export function createCodingAssistantAgent(
    options: CreateCodingAssistantAgentOptions,
): CodingAssistantRuntime {
    const processManager = options.processManager ?? new NativeProxessManager();
    const agentId = options.agentId ?? createId();
    const workflowsEnabled = options.workflows !== undefined && options.workflowsEnabled !== false;
    const sharedContextOptions = {
        ...(options.goals !== undefined ? { goals: options.goals } : {}),
        ...(options.permissionMode !== undefined ? { permissionMode: options.permissionMode } : {}),
        ...(options.tasks !== undefined ? { tasks: options.tasks } : {}),
        ...(options.userInput !== undefined ? { userInput: options.userInput } : {}),
        ...(workflowsEnabled ? { workflows: options.workflows } : {}),
    };
    const context =
        options.docker === undefined
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
            ? "claude-sdk"
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
    const providerType = providerId === "gym" ? "gym" : providerConfig?.type;
    const bedrockRoute = providerType === "bedrock" ? getBedrockModelRoute(modelId) : undefined;
    const usesClaudeTools = providerType === "claude" || bedrockRoute?.provider === "anthropic";
    const usesCodexTools =
        providerType === "codex" || providerType === "gym" || bedrockRoute?.provider === "openai";
    const baseTools: readonly AnyDefinedTool[] = usesClaudeTools
        ? claudeCodeTools
        : usesCodexTools
          ? codexTools
          : piTools;
    const collaborationTools = (
        usesCodexTools
            ? codexCollaborationTools
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
        options.goals === undefined ? toolsWithoutGoals : [...toolsWithoutGoals, ...goalTools];
    const env = options.env ?? process.env;
    const provider = (() => {
        if (providerType === "gym") return createGymProviderFromEnvironment(env);
        if (providerConfig?.type === "bedrock") {
            const bearerToken = readConfiguredBedrockBearerToken(providerConfig, env);
            if (bearerToken === undefined) {
                throw new Error(
                    `Inference provider '${providerId}' requires the ${providerConfig.bearerTokenEnvVar ?? "AWS_BEARER_TOKEN_BEDROCK"} environment variable.`,
                );
            }
            return filterConfiguredProviderModels(
                createBedrockProvider({
                    bearerToken,
                    env,
                    id: providerId,
                    ...(providerConfig.modelOverrides === undefined
                        ? {}
                        : { modelOverrides: providerConfig.modelOverrides }),
                    ...(providerConfig.region === undefined
                        ? {}
                        : { region: providerConfig.region }),
                }),
                providerConfig,
            );
        }
        if (providerConfig?.type === "claude") {
            return filterConfiguredProviderModels(
                createClaudeSdkProvider({
                    agentContext: context,
                    env:
                        providerConfig.configDir === undefined
                            ? env
                            : { ...env, CLAUDE_CONFIG_DIR: providerConfig.configDir },
                    id: providerId,
                    ...(providerConfig.executable === undefined
                        ? {}
                        : { pathToClaudeCodeExecutable: providerConfig.executable }),
                    sessionId: createClaudeSessionId(agentId),
                    tools,
                }),
                providerConfig,
            );
        }
        if (providerConfig?.type === "codex") {
            return filterConfiguredProviderModels(
                createCodexProvider(toCodexProviderOptions(options, providerId, providerConfig)),
                providerConfig,
            );
        }
        throw new Error(`Unknown inference provider '${providerId}'.`);
    })();
    const agentOptions: AgentOptions = {
        provider,
        modelId,
        context,
        id: agentId,
        instructions: options.instructions ?? createDefaultInstructions(runtimeCwd),
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

function createGymProviderFromEnvironment(env: NodeJS.ProcessEnv) {
    const endpoint = env.RIG_GYM_INFERENCE_URL;
    if (endpoint === undefined || endpoint.trim().length === 0) {
        throw new Error("RIG_GYM_INFERENCE_URL is required for the gym provider.");
    }
    const contextWindow = readGymContextWindow(env);
    return createGymProvider({
        ...(contextWindow === undefined ? {} : { contextWindow }),
        endpoint,
        ...(env.RIG_GYM_TOKEN === undefined ? {} : { token: env.RIG_GYM_TOKEN }),
    });
}

function toCodexProviderOptions(
    options: CreateCodingAssistantAgentOptions,
    providerId: string,
    config: ConfigCodexProvider,
): CodexProviderOptions {
    const providerOptions: CodexProviderOptions = { id: providerId };
    const env = options.env ?? process.env;
    if (options.apiKey !== undefined) {
        providerOptions.apiKey = options.apiKey;
    }
    if (config.authFile !== undefined) {
        providerOptions.codexAuthPath = config.authFile;
    }
    const baseUrl = config.baseUrl ?? env.RIG_CODEX_BASE_URL;
    if (baseUrl !== undefined) {
        providerOptions.baseUrl = baseUrl;
    }
    const transport = config.transport ?? env.RIG_CODEX_TRANSPORT;
    if (
        transport === "auto" ||
        transport === "sse" ||
        transport === "websocket" ||
        transport === "websocket-cached"
    ) {
        providerOptions.transport = transport;
    }

    return providerOptions;
}
