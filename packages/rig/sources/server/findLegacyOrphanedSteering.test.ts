import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../protocol/index.js";
import { findLegacyOrphanedSteering } from "./findLegacyOrphanedSteering.js";

describe("findLegacyOrphanedSteering", () => {
    it("returns ordered user steering strictly inside a matching terminal run epoch", () => {
        const first = steerSubmitted("first", "run-1", 2);
        const second = steerSubmitted("second", "run-1", 3);
        const storedMissingEvent = steerSubmitted("stored", "run-1", 4);
        const wrongRunApplication = steerSubmitted("wrong-run-application", "run-1", 5);
        const notification = steerSubmitted("notification", "run-1", 6, "notification");
        const events: SessionEvent[] = [
            event("run_started", 1, { runId: "run-1" }),
            first,
            second,
            storedMissingEvent,
            wrongRunApplication,
            notification,
            event("steering_applied", 7, {
                messageIds: [second.data.message.id, "another-applied-message"],
                runId: "run-1",
            }),
            event("steering_applied", 8, {
                messageIds: [wrongRunApplication.data.message.id],
                runId: "another-run",
            }),
            event("run_finished", 9, {
                agentRunId: "agent-run-1",
                modelLocked: true,
                runId: "run-1",
                stopReason: "aborted",
            }),
        ];

        expect(findLegacyOrphanedSteering(events)).toEqual([
            {
                events: [first, storedMissingEvent, wrongRunApplication],
                runId: "run-1",
            },
        ]);
    });

    it("ignores invalid ordering, active runs, and candidates before reset or rewind", () => {
        const active = steerSubmitted("active", "active-run", 2);
        const afterTerminal = steerSubmitted("after-terminal", "terminal-first", 5);
        const noStart = steerSubmitted("no-start", "missing-start", 6);
        const beforeReset = steerSubmitted("before-reset", "reset-run", 8);
        const beforeRewind = steerSubmitted("before-rewind", "rewind-run", 12);
        const afterRewind = steerSubmitted("after-rewind", "valid-run", 16);
        const events: SessionEvent[] = [
            event("run_started", 1, { runId: "active-run" }),
            active,
            event("run_started", 3, { runId: "terminal-first" }),
            finished("terminal-first", 4),
            afterTerminal,
            noStart,
            event("run_started", 7, { runId: "reset-run" }),
            beforeReset,
            finished("reset-run", 9),
            resetEvent(10),
            event("run_started", 11, { runId: "rewind-run" }),
            beforeRewind,
            event("run_error", 13, {
                errorMessage: "legacy failure",
                modelLocked: true,
                runId: "rewind-run",
            }),
            rewindEvent(14),
            event("run_started", 15, { runId: "valid-run" }),
            afterRewind,
            event("run_error", 17, {
                errorMessage: "terminal error",
                modelLocked: true,
                runId: "valid-run",
            }),
        ];

        expect(findLegacyOrphanedSteering(events)).toEqual([
            { events: [afterRewind], runId: "valid-run" },
        ]);
    });

    it("treats an existing same-run application as a complete no-op", () => {
        const applied = steerSubmitted("already-applied", "run-1", 2);
        expect(
            findLegacyOrphanedSteering([
                event("run_started", 1, { runId: "run-1" }),
                applied,
                event("steering_applied", 3, {
                    messageIds: [applied.data.message.id],
                    runId: "run-1",
                }),
                finished("run-1", 4),
            ]),
        ).toEqual([]);
    });

    it("does not let a pre-reset application suppress the current conversation epoch", () => {
        const old = steerSubmitted("reused-message-id", "old-run", 2);
        const current = steerSubmitted("reused-message-id", "current-run", 7);
        expect(
            findLegacyOrphanedSteering([
                event("run_started", 1, { runId: "old-run" }),
                old,
                event("steering_applied", 3, {
                    messageIds: [old.data.message.id],
                    runId: "old-run",
                }),
                finished("old-run", 4),
                resetEvent(5),
                event("run_started", 6, { runId: "current-run" }),
                current,
                finished("current-run", 8),
            ]),
        ).toEqual([{ events: [current], runId: "current-run" }]);
    });

    it("does not treat a startup interruption as proof that steering reached inference", () => {
        const active = steerSubmitted("active-message", "active-run", 2);
        expect(
            findLegacyOrphanedSteering([
                event("run_started", 1, { runId: "active-run" }),
                active,
                event("run_error", 3, {
                    errorMessage: "The server restarted.",
                    modelLocked: true,
                    runId: "active-run",
                    startupInterruption: true,
                }),
            ]),
        ).toEqual([]);
    });

    it("recognizes unmarked startup interruptions written by older versions", () => {
        const active = steerSubmitted("legacy-active-message", "legacy-active-run", 2);
        expect(
            findLegacyOrphanedSteering([
                event("run_started", 1, { runId: "legacy-active-run" }),
                active,
                event("run_error", 3, {
                    errorMessage:
                        "The subagent stopped working because the local server restarted before its suspended run finished.",
                    modelLocked: true,
                    runId: "legacy-active-run",
                }),
            ]),
        ).toEqual([]);
    });
});

function steerSubmitted(
    messageId: string,
    runId: string,
    createdAt: number,
    source?: "notification",
): Extract<SessionEvent, { type: "message_submitted" }> {
    return event("message_submitted", createdAt, {
        delivery: "steer",
        displayText: messageId,
        message: {
            blocks: [{ text: messageId, type: "text" }],
            id: messageId,
            role: "user",
        },
        runId,
        ...(source === undefined ? {} : { source }),
    });
}

function finished(
    runId: string,
    createdAt: number,
): Extract<SessionEvent, { type: "run_finished" }> {
    return event("run_finished", createdAt, {
        agentRunId: `agent-${runId}`,
        modelLocked: true,
        runId,
        stopReason: "stop",
    });
}

function resetEvent(createdAt: number): Extract<SessionEvent, { type: "session_reset" }> {
    return event("session_reset", createdAt, { snapshot: snapshot() });
}

function rewindEvent(createdAt: number): Extract<SessionEvent, { type: "session_rewound" }> {
    return event("session_rewound", createdAt, {
        messageId: "rewind-target",
        snapshot: snapshot(),
    });
}

function snapshot(): Extract<SessionEvent, { type: "session_reset" }>["data"]["snapshot"] {
    return {
        id: "agent-1",
        messages: [],
        modelId: "openai/test",
        providerId: "codex",
        queue: [],
        status: "idle",
        tools: [],
    };
}

function event<TType extends SessionEvent["type"]>(
    type: TType,
    createdAt: number,
    data: Extract<SessionEvent, { type: TType }>["data"],
): Extract<SessionEvent, { type: TType }> {
    return {
        createdAt,
        data,
        id: `event-${String(createdAt)}`,
        sessionId: "session-1",
        type,
    } as Extract<SessionEvent, { type: TType }>;
}
