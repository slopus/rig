import type { AssistantContent, Context, StopReason, StreamOptions, Usage } from "./types.js";

export interface GymInferenceRequest {
    context: Context;
    modelId: string;
    options: StreamOptions;
    providerId: string;
}

export interface GymInferenceResponse {
    completionDelayMs?: number;
    content: readonly AssistantContent[];
    delayMs?: number;
    errorMessage?: string;
    responseModel?: string;
    stopReason?: StopReason;
    toolCallDeltaDelayMs?: number;
    usage?: Usage;
}
