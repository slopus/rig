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
    disconnectAfterTextDeltas?: number;
    errorAfterContentStart?: boolean;
    errorAfterTextDeltas?: number;
    errorMessage?: string;
    responseModel?: string;
    stopReason?: StopReason;
    thinkingDeltaChunkSize?: number;
    thinkingDeltaDelayMs?: number;
    textDeltaChunkSize?: number;
    textDeltaDelayMs?: number;
    toolCallDeltaDelayMs?: number;
    usage?: Usage;
}
