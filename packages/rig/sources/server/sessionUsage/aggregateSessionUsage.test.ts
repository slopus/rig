import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../../protocol/index.js";
import type { Usage } from "../../providers/types.js";
import { aggregateSessionUsage } from "./aggregateSessionUsage.js";

describe("aggregateSessionUsage", () => {
    it("groups attributed inference usage by provider and display model", () => {
        const result = aggregateSessionUsage(
            [
                inference("event-1", usage(10), {
                    providerId: "codex",
                    requestedModelId: "openai/gpt-5.6",
                    responseModel: "gpt-5.6-2026-07-01",
                }),
                inference("event-2", usage(20), {
                    providerId: "codex",
                    requestedModelId: "openai/gpt-5.6-fast",
                    responseModel: "gpt-5.6-2026-07-01",
                }),
                inference("event-3", usage(7), {
                    providerId: "codex",
                    requestedModelId: "openai/gpt-5.6",
                }),
                inference("event-4", usage(5), {
                    providerId: "claude-sdk",
                    requestedModelId: "anthropic/claude-sonnet-4-6",
                }),
            ],
            primary,
        );

        expect(result.groups).toHaveLength(3);
        expect(result.groups[0]).toMatchObject({
            kind: "attributed",
            modelId: "gpt-5.6-2026-07-01",
            providerId: "codex",
            requestedModelId: "openai/gpt-5.6",
            responseModel: "gpt-5.6-2026-07-01",
            usage: {
                cacheRead: 6,
                cacheWrite: 9,
                cost: { input: 90, output: 120, total: 300 },
                input: 30,
                output: 60,
                totalTokens: 300,
            },
        });
        expect(result.groups[1]).toMatchObject({
            modelId: "openai/gpt-5.6",
            providerId: "codex",
            usage: { input: 7 },
        });
        expect(result.groups[2]).toMatchObject({
            modelId: "anthropic/claude-sonnet-4-6",
            providerId: "claude-sdk",
            usage: { input: 5 },
        });
        expect(result.currentContext).toEqual({
            approximate: false,
            modelId: "anthropic/claude-sonnet-4-6",
            providerId: "claude-sdk",
            requestedModelId: "anthropic/claude-sonnet-4-6",
            totalTokens: 50,
        });
    });

    it("only counts usage after the latest session reset", () => {
        expect(
            aggregateSessionUsage(
                [
                    inference("before-reset", usage(10), {
                        providerId: "codex",
                        requestedModelId: "openai/old",
                    }),
                    reset("reset-only", "codex", "openai/gpt-5.6"),
                ],
                primary,
            ).currentContext,
        ).toBeUndefined();

        const result = aggregateSessionUsage(
            [
                inference("before", usage(100), {
                    providerId: "codex",
                    requestedModelId: "openai/old",
                }),
                reset("reset-1", "claude-sdk", "anthropic/claude-sonnet-4-6"),
                inference("between", usage(20), {
                    providerId: "claude-sdk",
                    requestedModelId: "anthropic/claude-sonnet-4-6",
                }),
                reset("reset-2", "codex", "openai/gpt-5.6"),
                inference("after", usage(3), {
                    providerId: "codex",
                    requestedModelId: "openai/gpt-5.6",
                }),
            ],
            primary,
        );

        expect(result.groups).toHaveLength(1);
        expect(result.groups[0]).toMatchObject({
            modelId: "openai/gpt-5.6",
            providerId: "codex",
            usage: { input: 3, totalTokens: 30 },
        });
    });

    it("preserves consumed usage across rewinds while invalidating current context", () => {
        const events = [
            inference("before-rewind", usage(11), {
                providerId: "codex",
                requestedModelId: "openai/gpt-5.6",
            }),
            rewind("rewind", "codex", "openai/gpt-5.6"),
        ];

        const rewound = aggregateSessionUsage(events, primary);

        expect(rewound.groups[0]).toMatchObject({ usage: { input: 11, totalTokens: 110 } });
        expect(rewound.currentContext).toBeUndefined();

        const refreshed = aggregateSessionUsage(
            [
                ...events,
                inference("after-rewind", usage(4), {
                    providerId: "codex",
                    requestedModelId: "openai/gpt-5.6",
                }),
            ],
            primary,
        );
        expect(refreshed.groups[0]).toMatchObject({ usage: { input: 15, totalTokens: 150 } });
        expect(refreshed.currentContext).toMatchObject({ approximate: false, totalTokens: 40 });
    });

    it("keeps incomplete legacy attribution in an explicit unavailable bucket", () => {
        const result = aggregateSessionUsage(
            [
                inference("attributed", usage(4), {
                    providerId: "codex",
                    requestedModelId: "openai/gpt-5.6",
                }),
                inference("legacy", usage(8)),
                inference("partial-attribution", usage(2), { providerId: "codex" }),
            ],
            primary,
        );

        expect(result.groups).toEqual([
            expect.objectContaining({
                kind: "attributed",
                modelId: "openai/gpt-5.6",
                providerId: "codex",
                usage: usage(4),
            }),
            {
                kind: "earlier",
                label: "Earlier usage",
                modelId: null,
                modelLabel: "Model unavailable",
                providerId: null,
                requestedModelId: null,
                usage: usage(10),
            },
        ]);
        expect(result.currentContext).toMatchObject({
            approximate: false,
            modelId: "openai/gpt-5.6",
            providerId: "codex",
            totalTokens: 40,
        });
    });

    it("tracks exact inference context and approximate compaction context for the active model", () => {
        const initial = [
            created("created", "codex", "openai/gpt-5.6"),
            inference("codex-inference", usage(12), {
                providerId: "codex",
                requestedModelId: "openai/gpt-5.6",
                responseModel: "gpt-5.6-2026-07-01",
            }),
        ];
        expect(aggregateSessionUsage(initial, primary).currentContext).toEqual({
            approximate: false,
            modelId: "gpt-5.6-2026-07-01",
            providerId: "codex",
            requestedModelId: "openai/gpt-5.6",
            responseModel: "gpt-5.6-2026-07-01",
            totalTokens: 120,
        });

        const changed = [
            ...initial,
            modelChanged("changed", "claude-sdk", "anthropic/claude-sonnet-4-6"),
        ];
        expect(aggregateSessionUsage(changed, primary).currentContext).toBeUndefined();

        const compacted = [...changed, contextCompacted("compacted", 45)];
        expect(aggregateSessionUsage(compacted, primary).currentContext).toEqual({
            approximate: true,
            modelId: "anthropic/claude-sonnet-4-6",
            providerId: "claude-sdk",
            requestedModelId: "anthropic/claude-sonnet-4-6",
            totalTokens: 45,
        });

        const refreshed = [
            ...compacted,
            inference("claude-inference", usage(9), {
                providerId: "claude-sdk",
                requestedModelId: "anthropic/claude-sonnet-4-6",
                responseModel: "claude-sonnet-4-6-20260301",
            }),
        ];
        expect(aggregateSessionUsage(refreshed, primary).currentContext).toEqual({
            approximate: false,
            modelId: "claude-sonnet-4-6-20260301",
            providerId: "claude-sdk",
            requestedModelId: "anthropic/claude-sonnet-4-6",
            responseModel: "claude-sonnet-4-6-20260301",
            totalTokens: 90,
        });
    });

    it("excludes subagent sessions based on caller-provided session metadata", () => {
        const result = aggregateSessionUsage(
            [
                inference("subagent-inference", usage(10), {
                    providerId: "codex",
                    requestedModelId: "openai/gpt-5.6",
                }),
            ],
            { type: "subagent" },
        );

        expect(result).toEqual({ groups: [] });
    });
});

const primary = { type: "primary" } as const;

function usage(input: number): Usage {
    return {
        cacheRead: input * 0.2,
        cacheWrite: input * 0.3,
        cost: {
            cacheRead: input,
            cacheWrite: input * 2,
            input: input * 3,
            output: input * 4,
            total: input * 10,
        },
        input,
        output: input * 2,
        totalTokens: input * 10,
    };
}

function inference(
    id: string,
    eventUsage: Usage,
    attribution: { providerId?: string; requestedModelId?: string; responseModel?: string } = {},
): SessionEvent {
    return {
        createdAt: 1,
        data: {
            message: {
                blocks: [{ text: "done", type: "text" }],
                id: `message-${id}`,
                role: "agent",
                usage: eventUsage,
                ...attribution,
            },
            runId: `run-${id}`,
        },
        id,
        sessionId: "session-1",
        type: "agent_message",
    } as SessionEvent;
}

function reset(id: string, providerId: string, modelId: string): SessionEvent {
    return snapshotEvent(id, "session_reset", providerId, modelId);
}

function rewind(id: string, providerId: string, modelId: string): SessionEvent {
    return snapshotEvent(id, "session_rewound", providerId, modelId);
}

function modelChanged(id: string, providerId: string, modelId: string): SessionEvent {
    return snapshotEvent(id, "model_changed", providerId, modelId);
}

function snapshotEvent(
    id: string,
    type: "model_changed" | "session_reset" | "session_rewound",
    providerId: string,
    modelId: string,
): SessionEvent {
    return {
        createdAt: 1,
        data: {
            ...(type === "session_rewound" ? { messageId: "message-1" } : {}),
            ...(type === "model_changed" ? { modelId } : {}),
            snapshot: { modelId, providerId },
        },
        id,
        sessionId: "session-1",
        type,
    } as SessionEvent;
}

function contextCompacted(id: string, estimatedTokensAfter: number): SessionEvent {
    return {
        createdAt: 1,
        data: {
            event: {
                compactedMessageCount: 2,
                estimatedTokensAfter,
                estimatedTokensBefore: 100,
                reason: "threshold",
                type: "context_compacted",
            },
            runId: "run-1",
        },
        id,
        sessionId: "session-1",
        type: "agent_event",
    } as SessionEvent;
}

function created(id: string, providerId: string, modelId: string): SessionEvent {
    return {
        createdAt: 1,
        data: { session: { modelId, providerId } },
        id,
        sessionId: "session-1",
        type: "session_created",
    } as SessionEvent;
}
