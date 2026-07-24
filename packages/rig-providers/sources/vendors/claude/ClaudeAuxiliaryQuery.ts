export interface ClaudeAuxiliaryQueryRequest {
    prompt: string;
    signal?: AbortSignal;
    systemPrompt: string;
    tools?: readonly "WebSearch"[];
}

export interface ClaudeAuxiliaryQueryResponse {
    content: readonly unknown[];
}
