import {
  Agent,
  createNodeAgentContext,
  type AgentOptions,
} from "../agent/index.js";
import { NativeProxessManager } from "../processes/index.js";
import {
  createCodexProvider,
  type CodexProviderOptions,
} from "../providers/codex.js";
import { modelOpenaiGpt55 } from "../providers/models.js";
import type { CodingAssistantRuntime } from "./CodingAssistantRuntime.js";
import { createDefaultInstructions } from "./createDefaultInstructions.js";

export interface CreateCodingAssistantAgentOptions {
  cwd: string;
  apiKey?: string;
  effort?: string;
  instructions?: string;
  modelId?: string;
  processManager?: NativeProxessManager;
}

export function createCodingAssistantAgent(
  options: CreateCodingAssistantAgentOptions,
): CodingAssistantRuntime {
  const processManager = options.processManager ?? new NativeProxessManager();
  const context = createNodeAgentContext({
    cwd: options.cwd,
    processManager,
  });
  const providerOptions: CodexProviderOptions = {};
  if (options.apiKey !== undefined) {
    providerOptions.apiKey = options.apiKey;
  }

  const provider = createCodexProvider(providerOptions);
  const agentOptions: AgentOptions = {
    provider,
    modelId: options.modelId ?? modelOpenaiGpt55.id,
    context,
    instructions: options.instructions ?? createDefaultInstructions(options.cwd),
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
