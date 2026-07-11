import type { AssistantContent, Context, StopReason, StreamOptions, Usage } from "./types.js";

export interface GymInferenceRequest {
    context: Context;
    modelId: string;
    options: StreamOptions;
}

export interface GymInferenceResponse {
    content: readonly AssistantContent[];
    delayMs?: number;
    errorMessage?: string;
    responseModel?: string;
    stopReason?: StopReason;
    usage?: Usage;
}
