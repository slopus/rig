import type { AgentContext } from "./context/AgentContext.js";
import { loadAgentsMdInstructions } from "./loadAgentsMdInstructions.js";
import { selectSystemPromptForModel } from "./selectSystemPromptForModel.js";
import { systemMessageToText } from "./systemMessageToText.js";
import type { Message } from "./types.js";
import type { Model, Provider } from "../providers/types.js";

export interface CreateSystemPromptOptions {
  provider: Provider;
  model: Model;
  instructions?: string;
  messages: readonly Message[];
  context: AgentContext;
}

export async function createSystemPrompt(
  options: CreateSystemPromptOptions,
): Promise<string | undefined> {
  const parts: string[] = [];
  const modelPrompt = selectSystemPromptForModel(options.provider, options.model);
  if (modelPrompt !== undefined && modelPrompt.length > 0) {
    parts.push(modelPrompt);
  }

  if (options.instructions !== undefined && options.instructions.length > 0) {
    parts.push(options.instructions);
  }

  for (const message of options.messages) {
    if (message.role === "system") {
      parts.push(systemMessageToText(message));
    }
  }

  const agentsMdInstructions = await loadAgentsMdInstructions(options.context.fs);
  if (agentsMdInstructions !== undefined) {
    parts.push(agentsMdInstructions);
  }

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}
