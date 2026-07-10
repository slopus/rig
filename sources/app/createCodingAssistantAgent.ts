import {
    Agent,
    createNodeAgentContext,
    type AgentOptions,
    type AnyDefinedTool,
    type PermissionMode,
    type SubagentContext,
    type UserInputContext,
} from "../agent/index.js";
import type { Message } from "../agent/types.js";
import { NativeProxessManager } from "../processes/index.js";
import { createBedrockProvider } from "../providers/bedrock.js";
import { createClaudeSdkProvider } from "../providers/claude-sdk.js";
import { createCodexProvider, type CodexProviderOptions } from "../providers/codex.js";
import { getBedrockModelRoute } from "../providers/getBedrockModelRoute.js";
import { modelOpenaiGpt56Sol } from "../providers/models.js";
import { claudeCodeTools } from "../tools/claude/index.js";
import { codexTools } from "../tools/codex/index.js";
import { piTools } from "../tools/pi/index.js";
import { agentTool } from "../tools/Agent.js";
import type { CodingAssistantRuntime } from "./CodingAssistantRuntime.js";
import { createDefaultInstructions } from "./createDefaultInstructions.js";

export interface CreateCodingAssistantAgentOptions {
    cwd: string;
    agentId?: string;
    apiKey?: string;
    effort?: string;
    env?: NodeJS.ProcessEnv;
    instructions?: string;
    messages?: readonly Message[];
    contextMessages?: readonly Message[];
    modelId?: string;
    providerId?: string;
    processManager?: NativeProxessManager;
    permissionMode?: PermissionMode;
    subagents?: SubagentContext;
    userInput?: UserInputContext;
}

export function createCodingAssistantAgent(
    options: CreateCodingAssistantAgentOptions,
): CodingAssistantRuntime {
    const processManager = options.processManager ?? new NativeProxessManager();
    const context = createNodeAgentContext({
        cwd: options.cwd,
        processManager,
        ...(options.permissionMode !== undefined ? { permissionMode: options.permissionMode } : {}),
        ...(options.userInput !== undefined ? { userInput: options.userInput } : {}),
    });
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
    const baseTools: readonly AnyDefinedTool[] =
        providerId === "claude-sdk" || bedrockRoute?.provider === "anthropic"
            ? claudeCodeTools
            : providerId === "codex" || bedrockRoute?.provider === "openai"
              ? codexTools
              : piTools;
    const tools = options.subagents?.canSpawn === true ? [...baseTools, agentTool] : [...baseTools];
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
                : (() => {
                      throw new Error(`Unknown inference provider '${providerId}'.`);
                  })();
    const agentOptions: AgentOptions = {
        provider,
        modelId,
        context,
        ...(options.agentId !== undefined ? { id: options.agentId } : {}),
        instructions: options.instructions ?? createDefaultInstructions(options.cwd),
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
        cwd: options.cwd,
        processManager,
        provider,
    };
}

function toCodexProviderOptions(options: CreateCodingAssistantAgentOptions): CodexProviderOptions {
    const providerOptions: CodexProviderOptions = {};
    if (options.apiKey !== undefined) {
        providerOptions.apiKey = options.apiKey;
    }

    return providerOptions;
}
