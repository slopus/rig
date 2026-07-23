import type {
    AssistantContent,
    Context,
    ProviderError,
    StopReason,
    StreamOptions,
    Usage,
} from "@slopus/rig-execution";

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
    providerError?: ProviderError;
    responseModel?: string;
    stopReason?: StopReason;
    thinkingDeltaChunkSize?: number;
    thinkingDeltaDelayMs?: number;
    textDeltaChunkSize?: number;
    textDeltaDelayMs?: number;
    toolCallDeltaDelayMs?: number;
    usage?: Usage;
}
