import { CLAUDE_CODE_SYSTEM_PROMPT } from "./prompts/claudeCodeSystemPrompt.js";
import { GPT_5_4_SYSTEM_PROMPT } from "./prompts/gpt54SystemPrompt.js";
import { GPT_5_5_SYSTEM_PROMPT } from "./prompts/gpt55SystemPrompt.js";
import { KIMI_SYSTEM_PROMPT } from "./prompts/kimiSystemPrompt.js";
import type { Model, Provider } from "../providers/types.js";

const MODERN_CLAUDE_MODEL_PATTERNS = [
    "fable-5",
    "opus-4",
    "sonnet-5",
    "sonnet-4",
    "haiku-4-5",
] as const;

export function selectSystemPromptForModel(provider: Provider, model: Model): string | undefined {
    const providerId = provider.id.toLowerCase();
    const modelId = model.id.toLowerCase();
    const modelName = model.name.toLowerCase();
    const modelIdentity = `${modelId} ${modelName}`;

    if (MODERN_CLAUDE_MODEL_PATTERNS.some((pattern) => modelIdentity.includes(pattern))) {
        return CLAUDE_CODE_SYSTEM_PROMPT;
    }

    if (modelIdentity.includes("kimi")) {
        return KIMI_SYSTEM_PROMPT;
    }

    if (
        providerId.includes("codex") ||
        providerId.includes("openai") ||
        modelId.includes("openai/") ||
        modelName.includes("gpt")
    ) {
        if (modelIdentity.includes("gpt-5.6") || modelIdentity.includes("gpt-5.5")) {
            return GPT_5_5_SYSTEM_PROMPT;
        }

        if (modelIdentity.includes("gpt-5.4")) {
            return GPT_5_4_SYSTEM_PROMPT;
        }
    }

    return undefined;
}
