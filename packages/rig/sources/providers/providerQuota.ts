export type ProviderQuotaSource = "codex" | "claude-sdk";

export interface AvailableProviderQuota {
    status: "available";
    source: ProviderQuotaSource;
    window: "five_hour";
    usedPercent: number;
    resetsAt: number;
    capturedAt: number;
}

export interface UnavailableProviderQuota {
    status: "unavailable";
    source: ProviderQuotaSource;
    window: "five_hour";
    capturedAt: number;
}

export type ProviderQuota = AvailableProviderQuota | UnavailableProviderQuota;
