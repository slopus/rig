import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../../protocol/index.js";
import type { ProviderQuota, ProviderQuotaSource } from "../../providers/providerQuota.js";
import { aggregateQuotaContributions } from "./aggregateQuotaContributions.js";

describe("aggregateQuotaContributions", () => {
    it("adds only monotonic observed movement within the same window epoch", () => {
        const events = [
            observation("a-before", "a", "before", "codex", quota("codex", 20, 10, 100)),
            observation("a-after", "a", "after", "codex", quota("codex", 23.5, 11, 100)),
            observation("b-before", "b", "before", "codex", quota("codex", 23.5, 11, 100)),
            observation("b-after", "b", "after", "codex", quota("codex", 22, 9, 100)),
        ];

        expect(aggregateQuotaContributions(events)).toEqual([
            {
                providerId: "codex",
                windows: {
                    fiveHour: { observedUsedPercent: 3.5 },
                    weekly: { observedUsedPercent: 1 },
                },
            },
        ]);
    });

    it("ignores a delta across reset rollover and resumes within the new epoch", () => {
        const events = [
            observation("old-before", "old", "before", "codex", quota("codex", 90, 40, 100)),
            observation("old-after", "old", "after", "codex", quota("codex", 95, 42, 100)),
            observation("roll-before", "roll", "before", "codex", quota("codex", 95, 42, 100)),
            observation("roll-after", "roll", "after", "codex", quota("codex", 2, 1, 200)),
            observation("new-before", "new", "before", "codex", quota("codex", 2, 1, 200)),
            observation("new-after", "new", "after", "codex", quota("codex", 4, 2, 200)),
        ];

        expect(aggregateQuotaContributions(events)).toEqual([
            {
                providerId: "codex",
                windows: {
                    fiveHour: { observedUsedPercent: 7 },
                    weekly: { observedUsedPercent: 3 },
                },
            },
        ]);
    });

    it("deduplicates replayed observation IDs and separates providers", () => {
        const codexBefore = observation(
            "codex-before",
            "codex-run",
            "before",
            "codex",
            quota("codex", 1, 2, 100),
        );
        const codexAfter = observation(
            "codex-after",
            "codex-run",
            "after",
            "codex",
            quota("codex", 3, 5, 100),
        );
        const events = [
            codexBefore,
            codexAfter,
            { ...codexAfter, id: "replayed-after" },
            observation(
                "claude-before",
                "claude-run",
                "before",
                "claude-sdk",
                quota("claude-sdk", 10, 20, 300),
            ),
            observation(
                "claude-after",
                "claude-run",
                "after",
                "claude-sdk",
                quota("claude-sdk", 14, 25, 300),
            ),
        ];

        expect(aggregateQuotaContributions(events)).toEqual([
            {
                providerId: "codex",
                windows: {
                    fiveHour: { observedUsedPercent: 2 },
                    weekly: { observedUsedPercent: 3 },
                },
            },
            {
                providerId: "claude-sdk",
                windows: {
                    fiveHour: { observedUsedPercent: 4 },
                    weekly: { observedUsedPercent: 5 },
                },
            },
        ]);
    });

    it("resets observed movement on a new session boundary", () => {
        expect(
            aggregateQuotaContributions([
                observation("before-1", "one", "before", "codex", quota("codex", 1, 1, 100)),
                observation("after-1", "one", "after", "codex", quota("codex", 5, 5, 100)),
                reset(),
                observation("before-2", "two", "before", "codex", quota("codex", 5, 5, 100)),
                observation("after-2", "two", "after", "codex", quota("codex", 6, 7, 100)),
            ]),
        ).toEqual([
            {
                providerId: "codex",
                windows: {
                    fiveHour: { observedUsedPercent: 1 },
                    weekly: { observedUsedPercent: 2 },
                },
            },
        ]);
    });
});

function quota(
    source: ProviderQuotaSource,
    fiveHourUsed: number,
    weeklyUsed: number,
    epoch: number,
): ProviderQuota {
    return {
        capturedAt: epoch - 1,
        source,
        windows: {
            fiveHour: {
                durationMs: 18_000_000,
                resetsAt: epoch,
                status: "available",
                usedPercent: fiveHourUsed,
            },
            weekly: {
                durationMs: 604_800_000,
                resetsAt: epoch + 1,
                status: "available",
                usedPercent: weeklyUsed,
            },
        },
    };
}

function observation(
    id: string,
    observationId: string,
    phase: "before" | "after",
    providerId: string,
    observedQuota: ProviderQuota,
): SessionEvent {
    return {
        createdAt: 1,
        data: { observationId, phase, providerId, quota: observedQuota, runId: observationId },
        id,
        sessionId: "session-1",
        type: "provider_quota_observed",
    };
}

function reset(): SessionEvent {
    return {
        createdAt: 1,
        data: {
            snapshot: {
                id: "agent-1",
                messages: [],
                modelId: "openai/gpt-5.6",
                providerId: "codex",
                queue: [],
                status: "idle",
                tools: [],
            },
        },
        id: "reset",
        sessionId: "session-1",
        type: "session_reset",
    };
}
