import type {
    GetSessionUsageResponse,
    SessionQuotaWindowContribution,
    SessionUsageGroup,
} from "../protocol/index.js";
import type { ProviderQuotaWindow } from "../providers/providerQuota.js";
import type { CodingAssistantModelChoice } from "./CodingAssistantAgentBackend.js";
import { formatCompactTokens } from "./formatCompactTokens.js";

export function formatSessionUsageSummary(
    summary: GetSessionUsageResponse,
    modelChoices: readonly CodingAssistantModelChoice[],
    now = Date.now(),
): string {
    const lines: string[] = [];
    const providerIds = distinct([
        ...summary.groups.map((group) => group.providerId ?? "earlier"),
        ...summary.quotas.map((entry) => entry.providerId),
        ...summary.quotaContributions.map((entry) => entry.providerId),
        summary.currentProviderId,
    ]);

    for (const providerId of providerIds) {
        lines.push(providerName(providerId));
        for (const group of summary.groups.filter(
            (candidate) => (candidate.providerId ?? "earlier") === providerId,
        )) {
            lines.push(formatModelUsage(group, modelChoices));
        }
        if (providerId !== "earlier") {
            const quota = summary.quotas.find((entry) => entry.providerId === providerId)?.quota;
            const contribution = summary.quotaContributions.find(
                (entry) => entry.providerId === providerId,
            );
            lines.push(
                formatQuotaWindow("5-hour", quota?.windows.fiveHour, now),
                formatObservedContribution(contribution?.windows.fiveHour),
                formatQuotaWindow("Weekly", quota?.windows.weekly, now),
                formatObservedContribution(contribution?.windows.weekly),
            );
        }
        if (providerId === summary.currentProviderId) {
            lines.push(formatContext(summary, modelChoices));
        }
    }

    const total = summary.groups.reduce((sum, group) => sum + group.usage.totalTokens, 0);
    lines.push(`Overall session total: ${formatCompactTokens(total)}`);
    return lines.join("\n");
}

function formatModelUsage(
    group: SessionUsageGroup,
    modelChoices: readonly CodingAssistantModelChoice[],
): string {
    const model =
        group.modelId === null
            ? (group.modelLabel ?? "Model unavailable")
            : (modelChoices.find((choice) => choice.model.id === group.modelId)?.model.name ??
              group.modelId);
    const reasoning =
        group.usage.reasoning === undefined
            ? ""
            : ` · ${formatCompactTokens(group.usage.reasoning)} reasoning`;
    const cost =
        group.providerId === "claude-sdk" && group.usage.cost.total > 0
            ? ` · ${formatUsd(group.usage.cost.total)}`
            : "";
    return `${model} · ${formatCompactTokens(group.usage.input)} in · ${formatCompactTokens(group.usage.output)} out · ${formatCompactTokens(group.usage.cacheRead)} read · ${formatCompactTokens(group.usage.cacheWrite)} write${reasoning} · ${formatCompactTokens(group.usage.totalTokens)} total${cost}`;
}

function formatQuotaWindow(
    label: "5-hour" | "Weekly",
    window: ProviderQuotaWindow | undefined,
    now: number,
): string {
    if (window?.status !== "available") return `${label}: unavailable`;
    const left = Math.max(0, Math.min(100, Math.round(100 - window.usedPercent)));
    return `${label}: ${left}% left · resets in ${formatResetDuration(window.resetsAt - now)}`;
}

function formatObservedContribution(
    contribution: SessionQuotaWindowContribution | undefined,
): string {
    if (contribution === undefined) {
        return "Observed while this session was active: unavailable";
    }
    if (contribution.observedUsedPercent === 0) {
        return "Observed while this session was active: no increase";
    }
    const percent = formatPercent(contribution.observedUsedPercent);
    return `Observed while this session was active: ${percent}`;
}

function formatContext(
    summary: GetSessionUsageResponse,
    modelChoices: readonly CodingAssistantModelChoice[],
): string {
    const context = summary.context;
    if (context === undefined) return "Context: unavailable";
    const window = modelChoices.find(
        (choice) =>
            choice.providerId === context.providerId &&
            choice.model.id === context.requestedModelId,
    )?.model.contextWindow;
    const prefix = context.approximate ? "~" : "";
    if (window === undefined)
        return `Context: ${prefix}${formatCompactTokens(context.totalTokens)}`;
    const percentLeft = Math.max(0, Math.round((1 - context.totalTokens / window) * 100));
    return `Context: ${prefix}${formatCompactTokens(context.totalTokens)} / ${formatCompactTokens(window)} · ${percentLeft}% left`;
}

function formatResetDuration(milliseconds: number): string {
    if (milliseconds <= 0) return "now";
    const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
    const days = Math.floor(minutes / (24 * 60));
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    const remainingMinutes = minutes % 60;
    if (days > 0) return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
    if (hours === 0) return `${remainingMinutes}m`;
    if (remainingMinutes === 0) return `${hours}h`;
    return `${hours}h ${remainingMinutes}m`;
}

function formatPercent(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    if (rounded === 0) return "less than +0.1%";
    return `+${rounded}%`;
}

function formatUsd(value: number): string {
    return `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

function providerName(providerId: string): string {
    if (providerId === "codex") return "Codex";
    if (providerId === "claude-sdk") return "Claude";
    if (providerId === "earlier") return "Earlier usage";
    if (providerId === "gym") return "Gym";
    if (providerId === "bedrock") return "Amazon Bedrock";
    return providerId;
}

function distinct(values: readonly string[]): string[] {
    return [...new Set(values)];
}
