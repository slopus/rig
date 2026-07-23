import type { Usage } from "@slopus/rig-execution";

export interface AttributedSessionUsageGroup {
    kind: "attributed";
    modelId: string;
    providerId: string;
    requestedModelId: string;
    responseModel?: string;
    usage: Usage;
}

export type SessionUsageGroup = AttributedSessionUsageGroup;

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
    observedQuota: readonly SessionQuotaContribution[];
}

export interface SessionQuotaContribution {
    providerId: string;
    windows: {
        fiveHour?: SessionQuotaWindowContribution;
        weekly?: SessionQuotaWindowContribution;
    };
}

export interface SessionQuotaWindowContribution {
    observedUsedPercent: number;
}

export interface SessionUsageMetadata {
    type: "primary" | "subagent";
}
