import { CLAUDE_CODE_SYSTEM_PROMPT } from "./prompts/claudeCodeSystemPrompt.js";
import { GPT_5_4_SYSTEM_PROMPT } from "./prompts/gpt54SystemPrompt.js";
import { GPT_5_5_SYSTEM_PROMPT } from "./prompts/gpt55SystemPrompt.js";
import type { Model, Provider } from "../providers/types.js";

const MODERN_CLAUDE_MODEL_PATTERNS = [
  "fable-5",
  "opus-4",
  "sonnet-4",
  "haiku-4-5",
] as const;

export function selectSystemPromptForModel(
  provider: Provider,
  model: Model,
): string | undefined {
  const providerId = provider.id.toLowerCase();
  const modelId = model.id.toLowerCase();
  const modelName = model.name.toLowerCase();
  const modelIdentity = `${modelId} ${modelName}`;
  const modelSlug = modelId.replace(/^openai\//, "");

  if (
    MODERN_CLAUDE_MODEL_PATTERNS.some((pattern) =>
      modelIdentity.includes(pattern),
    )
  ) {
    return CLAUDE_CODE_SYSTEM_PROMPT;
  }

  if (
    providerId.includes("codex") ||
    providerId.includes("openai") ||
    modelId.includes("openai/") ||
    modelName.includes("gpt")
  ) {
    if (modelSlug === "gpt-5.5") {
      return GPT_5_5_SYSTEM_PROMPT;
    }

    if (modelSlug === "gpt-5.4") {
      return GPT_5_4_SYSTEM_PROMPT;
    }
  }

  return undefined;
}
