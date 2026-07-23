import type {
    GetSessionUsageResponse,
    SessionQuotaWindowContribution,
    SessionUsageGroup,
} from "../protocol/index.js";
import type { ProviderQuotaWindow } from "@slopus/rig-providers";
import type { CodingAssistantModelChoice } from "./CodingAssistantAgentBackend.js";
import { formatCompactTokens } from "./formatCompactTokens.js";
import { formatResetDuration } from "./formatResetDuration.js";
import { humanizeProviderId } from "./humanizeProviderId.js";

export function formatSessionUsageSummary(
    summary: GetSessionUsageResponse,
    modelChoices: readonly CodingAssistantModelChoice[],
    now = Date.now(),
): string {
    const lines: string[] = [];
    const providerIds = distinct([
        ...summary.groups.map((group) => group.providerId),
        ...summary.quotas.map((entry) => entry.providerId),
        ...summary.observedQuota.map((entry) => entry.providerId),
        summary.currentProviderId,
    ]);

    let hasObservedRemaining = false;
    for (const [providerIndex, providerId] of providerIds.entries()) {
        if (providerIndex > 0) lines.push("");
        lines.push(humanizeProviderId(providerId));
        const providerGroups = summary.groups.filter(
            (candidate) => candidate.providerId === providerId,
        );
        for (const group of providerGroups) {
            lines.push(`  ${modelName(group, modelChoices)}`);
            lines.push(`    ${formatModelUsage(group)}`);
            if (isCurrentContextGroup(group, summary)) {
                lines.push(`    ${formatContext(summary, modelChoices)}`);
            }
        }
        if (
            summary.context !== undefined &&
            providerId === summary.currentProviderId &&
            providerId === summary.context.providerId &&
            !providerGroups.some((group) => isCurrentContextGroup(group, summary))
        ) {
            lines.push(`  ${contextModelName(summary, modelChoices)}`);
            lines.push(`    ${formatContext(summary, modelChoices)}`);
        }
        const quota = summary.quotas.find((entry) => entry.providerId === providerId)?.quota;
        const contribution = summary.observedQuota.find((entry) => entry.providerId === providerId);
        lines.push(
            "  Account quota",
            `    ${formatQuotaWindow("5-hour", quota?.windows.fiveHour, now)}`,
            `    ${formatQuotaWindow("Weekly", quota?.windows.weekly, now)}`,
        );
        const observed = formatObservedQuota(contribution);
        if (observed !== undefined) {
            lines.push(`    ${observed}`);
            hasObservedRemaining = true;
        }
    }

    if (hasObservedRemaining) {
        lines.push("");
        lines.push("Observed remaining may include other account activity.");
    }
    const total = summary.groups.reduce((sum, group) => sum + group.usage.totalTokens, 0);
    lines.push(`Session total: ${formatTokens(total)}`);
    return lines.join("\n");
}

function contextModelName(
    summary: GetSessionUsageResponse,
    modelChoices: readonly CodingAssistantModelChoice[],
): string {
    const context = summary.context;
    if (context === undefined) return "Model unavailable";
    return (
        modelChoices.find(
            (choice) =>
                choice.providerId === context.providerId &&
                choice.model.id === context.requestedModelId,
        )?.model.name ?? humanizeIdentifier(context.modelId)
    );
}

function modelName(
    group: SessionUsageGroup,
    modelChoices: readonly CodingAssistantModelChoice[],
): string {
    const choice = modelChoices.find(
        (candidate) =>
            candidate.providerId === group.providerId && candidate.model.id === group.modelId,
    );
    return choice?.model.name ?? humanizeIdentifier(group.modelId);
}

function formatModelUsage(group: SessionUsageGroup): string {
    const reasoning =
        group.usage.reasoning === undefined
            ? ""
            : ` · ${formatTokens(group.usage.reasoning)} reasoning`;
    const cost =
        group.providerId === "claude" && group.usage.cost.total > 0
            ? ` · ${formatUsd(group.usage.cost.total)}`
            : "";
    return `${formatTokens(group.usage.totalTokens)} total · ${formatTokens(group.usage.input)} input · ${formatTokens(group.usage.output)} output · ${formatTokens(group.usage.cacheRead)} cache read · ${formatTokens(group.usage.cacheWrite)} cache write${reasoning}${cost}`;
}

function isCurrentContextGroup(
    group: SessionUsageGroup,
    summary: GetSessionUsageResponse,
): boolean {
    const context = summary.context;
    return (
        context !== undefined &&
        group.providerId === summary.currentProviderId &&
        group.providerId === context.providerId &&
        group.modelId === context.modelId
    );
}

function formatQuotaWindow(
    label: "5-hour" | "Weekly",
    window: ProviderQuotaWindow | undefined,
    now: number,
): string {
    if (window?.status !== "available") return `${label}: unavailable`;
    const left = Math.max(0, Math.min(100, 100 - window.usedPercent));
    return `${label}: ${formatPercent(left)} left · resets in ${formatResetDuration(window.resetsAt - now)}`;
}

function formatObservedQuota(
    contribution:
        | {
              windows: {
                  fiveHour?: SessionQuotaWindowContribution;
                  weekly?: SessionQuotaWindowContribution;
              };
          }
        | undefined,
): string | undefined {
    const windows = [
        formatObservedWindow("5h", contribution?.windows.fiveHour),
        formatObservedWindow("week", contribution?.windows.weekly),
    ].filter((value): value is string => value !== undefined);
    if (windows.length === 0) return undefined;
    return `Observed remaining: ${windows.join(" · ")} (approx.)`;
}

function formatObservedWindow(
    label: "5h" | "week",
    contribution: SessionQuotaWindowContribution | undefined,
): string | undefined {
    if (contribution === undefined || contribution.observedUsedPercent <= 0) return undefined;
    return `${label} ${formatPercent(-contribution.observedUsedPercent)}`;
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
    if (window === undefined) return `Context: ${prefix}${formatTokens(context.totalTokens)}`;
    const percentLeft = Math.max(0, (1 - context.totalTokens / window) * 100);
    return `Context: ${prefix}${formatTokens(context.totalTokens)} / ${formatTokens(window)} · ${formatPercent(percentLeft)} left`;
}

function formatPercent(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    if (Object.is(rounded, -0) || rounded === 0) return "0%";
    const sign = rounded < 0 ? "-" : "";
    const absolute = Math.abs(rounded);
    const number = absolute < 1 ? String(absolute).replace(/^0/u, "") : String(absolute);
    return `${sign}${number}%`;
}

function formatUsd(value: number): string {
    return `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

function formatTokens(value: number): string {
    return formatCompactTokens(Math.max(0, Math.round(value))).replace(/\.0([km])$/u, "$1");
}

function humanizeIdentifier(value: string): string {
    const name = value.split("/").at(-1) ?? value;
    return name
        .replaceAll(/[-_]+/gu, " ")
        .replace(/\b\p{L}/gu, (character) => character.toUpperCase());
}

function distinct(values: readonly string[]): string[] {
    return [...new Set(values)];
}
