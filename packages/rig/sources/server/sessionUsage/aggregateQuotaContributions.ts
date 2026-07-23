import type { SessionEvent } from "../../protocol/index.js";
import type { ProviderQuotaWindow } from "@slopus/rig-providers";
import type { SessionQuotaContribution } from "./types.js";

interface WindowEpoch {
    baselineUsedPercent: number;
    maximumUsedPercent: number;
    providerId: string;
    window: "fiveHour" | "weekly";
}

export function aggregateQuotaContributions(
    events: readonly SessionEvent[],
): SessionQuotaContribution[] {
    let epochs = new Map<string, WindowEpoch>();
    let providerOrder: string[] = [];

    for (const event of events) {
        if (event.type === "session_reset") {
            epochs = new Map();
            providerOrder = [];
            continue;
        }
        if (event.type !== "provider_quota_observed") continue;
        if (!providerOrder.includes(event.data.providerId))
            providerOrder.push(event.data.providerId);
        observeWindow(epochs, event.data.providerId, "fiveHour", event.data.quota.windows.fiveHour);
        observeWindow(epochs, event.data.providerId, "weekly", event.data.quota.windows.weekly);
    }

    return providerOrder.flatMap((providerId) => {
        const contribution: SessionQuotaContribution = { providerId, windows: {} };
        for (const window of ["fiveHour", "weekly"] as const) {
            const observedUsedPercent = [...epochs.values()]
                .filter((epoch) => epoch.providerId === providerId && epoch.window === window)
                .reduce(
                    (sum, epoch) =>
                        sum + Math.max(0, epoch.maximumUsedPercent - epoch.baselineUsedPercent),
                    0,
                );
            const hasEpoch = [...epochs.values()].some(
                (epoch) => epoch.providerId === providerId && epoch.window === window,
            );
            if (hasEpoch) contribution.windows[window] = { observedUsedPercent };
        }
        return contribution.windows.fiveHour === undefined &&
            contribution.windows.weekly === undefined
            ? []
            : [contribution];
    });
}

function observeWindow(
    epochs: Map<string, WindowEpoch>,
    providerId: string,
    windowName: "fiveHour" | "weekly",
    window: ProviderQuotaWindow | undefined,
): void {
    if (window?.status !== "available") return;
    const key = JSON.stringify([
        providerId,
        windowName,
        window.resetsAt,
        window.durationMs ?? null,
    ]);
    const epoch = epochs.get(key);
    if (epoch === undefined) {
        epochs.set(key, {
            baselineUsedPercent: window.usedPercent,
            maximumUsedPercent: window.usedPercent,
            providerId,
            window: windowName,
        });
        return;
    }
    epoch.maximumUsedPercent = Math.max(epoch.maximumUsedPercent, window.usedPercent);
}
