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
import type { WorkflowContext } from "../workflows/index.js";
import type { Message } from "../agent/types.js";
import { NativeProxessManager } from "../processes/index.js";
import { createBedrockProvider } from "../providers/bedrock.js";
import { createClaudeSdkProvider } from "../providers/claude-sdk.js";
import { createCodexProvider, type CodexProviderOptions } from "../providers/codex.js";
import { createGymProvider } from "../providers/createGymProvider.js";
import { getBedrockModelRoute } from "../providers/getBedrockModelRoute.js";
import { modelOpenaiGpt56Sol } from "../providers/models.js";
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
    const bedrockRoute = providerId === "bedrock" ? getBedrockModelRoute(modelId) : undefined;
    const usesClaudeTools = providerId === "claude-sdk" || bedrockRoute?.provider === "anthropic";
    const usesCodexTools =
        providerId === "codex" || providerId === "gym" || bedrockRoute?.provider === "openai";
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
    const provider =
        providerId === "bedrock"
            ? createBedrockProvider({ env: options.env ?? process.env })
            : providerId === "claude-sdk"
              ? createClaudeSdkProvider({
                    agentContext: context,
                    tools,
                })
              : providerId === "codex"
                ? createCodexProvider(toCodexProviderOptions(options))
                : providerId === "gym"
                  ? createGymProviderFromEnvironment(options.env ?? process.env)
                  : (() => {
                        throw new Error(`Unknown inference provider '${providerId}'.`);
                    })();
    const agentOptions: AgentOptions = {
        provider,
        modelId,
        context,
        ...(options.agentId !== undefined ? { id: options.agentId } : {}),
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
    return createGymProvider({
        endpoint,
        ...(env.RIG_GYM_TOKEN === undefined ? {} : { token: env.RIG_GYM_TOKEN }),
    });
}

function toCodexProviderOptions(options: CreateCodingAssistantAgentOptions): CodexProviderOptions {
    const providerOptions: CodexProviderOptions = {};
    if (options.apiKey !== undefined) {
        providerOptions.apiKey = options.apiKey;
    }

    return providerOptions;
}
