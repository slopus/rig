const CLAUDE_MODEL_IDS: Readonly<Record<string, string>> = {
    "anthropic/fable-5": "claude-fable-5[1m]",
    "anthropic/opus-4-8": "opus[1m]",
    "anthropic/sonnet-5": "sonnet[1m]",
};

export function resolveClaudeModelId(modelId: string): string {
    return CLAUDE_MODEL_IDS[modelId] ?? modelId;
}
