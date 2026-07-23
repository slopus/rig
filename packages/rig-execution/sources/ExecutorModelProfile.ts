import type {
    ProviderModelCompatibilityType,
    SessionMessage,
    SessionReasoningEffort,
    SessionServiceTier,
    SessionTool,
} from "@slopus/rig-providers";
import type { Model } from "@/types.js";

export interface ExecutorModelProfile {
    collaborationMode?: "direct" | "namespaced";
    contextWindow?: number;
    defaultEffort?: SessionReasoningEffort;
    id: string;
    model: Model;
    name: string;
    providerId: string;
    providerType: ProviderModelCompatibilityType;
    serviceTiers?: readonly SessionServiceTier[];
    prompt: string;
    toolMode?: "code_mode" | "standard";
}

export interface ExecutorSelection {
    modelId: string;
    providerId: string;
}

export interface ExecutorRunRequest {
    abort?: AbortSignal;
    context: { readonly messages: readonly SessionMessage[] };
    effort?: SessionReasoningEffort;
    tools?: readonly SessionTool[];
    selection: ExecutorSelection;
    serviceTier?: SessionServiceTier;
    contextInstructions?: string;
    systemPrompt?: string;
}
