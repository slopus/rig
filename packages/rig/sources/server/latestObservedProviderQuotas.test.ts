import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../protocol/index.js";
import type { ProviderQuota } from "@slopus/rig-providers";
import { latestObservedProviderQuotas } from "./latestObservedProviderQuotas.js";

describe("latestObservedProviderQuotas", () => {
    it("keeps the newest durable quota independently for each provider", () => {
        const events = [
            observed("codex-old", "codex", quota("codex", 1, 20)),
            observed("claude", "claude", quota("claude", 2, 30)),
            observed("codex-new", "codex", quota("codex", 3, 40)),
        ];

        expect([...latestObservedProviderQuotas(events)]).toEqual([
            ["codex", quota("codex", 3, 40)],
            ["claude", quota("claude", 2, 30)],
        ]);
    });
});

function observed(id: string, providerId: string, observedQuota: ProviderQuota): SessionEvent {
    return {
        createdAt: observedQuota.capturedAt,
        data: {
            observationId: id,
            phase: "after",
            providerId,
            quota: observedQuota,
            runId: id,
        },
        id,
        sessionId: "session",
        type: "provider_quota_observed",
    };
}

function quota(source: "codex" | "claude", capturedAt: number, usedPercent: number): ProviderQuota {
    return {
        capturedAt,
        source,
        windows: {
            fiveHour: { capturedAt, resetsAt: 100, status: "available", usedPercent },
            weekly: { status: "unavailable" },
        },
    };
}
