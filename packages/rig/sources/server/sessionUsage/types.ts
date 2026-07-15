import type { Usage } from "../../providers/types.js";

export const EARLIER_USAGE_LABEL = "Earlier usage";
export const MODEL_UNAVAILABLE_LABEL = "Model unavailable";

export interface AttributedSessionUsageGroup {
    kind: "attributed";
    modelId: string;
    providerId: string;
    requestedModelId: string;
    responseModel?: string;
    usage: Usage;
}

export interface EarlierSessionUsageGroup {
    kind: "earlier";
    label: typeof EARLIER_USAGE_LABEL;
    modelId: null;
    modelLabel: typeof MODEL_UNAVAILABLE_LABEL;
    providerId: null;
    requestedModelId: null;
    usage: Usage;
}

export type SessionUsageGroup = AttributedSessionUsageGroup | EarlierSessionUsageGroup;

export interface SessionContextUsage {
    approximate: boolean;
    modelId: string;
    providerId: string;
    requestedModelId: string;
    responseModel?: string;
    totalTokens: number;
}

export interface SessionUsageSummary {
    currentContext?: SessionContextUsage;
    groups: readonly SessionUsageGroup[];
}

export interface SessionUsageMetadata {
    type: "primary" | "subagent";
}
