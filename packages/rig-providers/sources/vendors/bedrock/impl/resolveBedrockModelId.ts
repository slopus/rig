const BEDROCK_MODEL_IDS: Readonly<Record<string, string>> = {
    "anthropic/fable-5": "anthropic.claude-fable-5",
    "anthropic/opus-4-8": "anthropic.claude-opus-4-8",
    "anthropic/sonnet-5": "anthropic.claude-sonnet-5",
    "openai/gpt-5.6-luna": "openai.gpt-5.6-luna",
    "openai/gpt-5.6-sol": "openai.gpt-5.6-sol",
    "openai/gpt-5.6-terra": "openai.gpt-5.6-terra",
};

export function resolveBedrockModelId(modelId: string): string {
    return BEDROCK_MODEL_IDS[modelId] ?? modelId;
}
