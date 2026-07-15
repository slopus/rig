import { describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "../protocol/index.js";
import { MAX_RETAINED_TRANSIENT_SESSION_EVENTS, SessionEventLog } from "./SessionEventLog.js";

const FIRST = "018bcfe5-6800-7001-8000-000000000001";
const OMITTED = "018bcfe5-6800-7002-8000-000000000002";
const DURABLE = "018bcfe5-6800-7003-8000-000000000003";
const TRAILING = "018bcfe5-6800-7004-8000-000000000004";
const FUTURE = "018bcfe5-6800-7005-8000-000000000005";

describe("SessionEventLog", () => {
    it("recovers an omitted ordered cursor without replaying its durable predecessor", () => {
        const log = new SessionEventLog({
            events: [event(FIRST)],
            lastEventId: OMITTED,
        });
        log.append(event(DURABLE));

        expect(log.since(OMITTED)?.map((entry) => entry.id)).toEqual([DURABLE]);
        expect(log.since(DURABLE)).toEqual([]);
    });

    it("rejects cursors that were not omitted from this session", () => {
        const log = new SessionEventLog({
            events: [event(FIRST), event(DURABLE)],
            lastEventId: TRAILING,
        });

        expect(log.since("not-an-event-id")).toBeUndefined();
        expect(log.since("018bcfe5-6800-7000-8000-000000000000")).toBeUndefined();
        expect(log.since(OMITTED)).toBeUndefined();
        expect(log.since(FUTURE)).toBeUndefined();
    });

    it("updates the cursor high-water while delivering appended events to subscribers", () => {
        const listener = vi.fn();
        const log = new SessionEventLog({ events: [event(FIRST)] });
        log.subscribe(listener);

        log.append(event(DURABLE));

        expect(log.lastEventId()).toBe(DURABLE);
        expect(listener).toHaveBeenCalledExactlyOnceWith(event(DURABLE));
    });

    it("bounds retained transient streams while preserving delivery, final state, and recent cursors", () => {
        const listener = vi.fn();
        const log = new SessionEventLog({ events: [event(FIRST)] });
        log.subscribe(listener);
        const transientIds: string[] = [];

        for (let index = 0; index < 10_000; index += 1) {
            const id = `018bcfe5-${String(0x6801 + Math.floor(index / 0x1000)).padStart(4, "0")}-7${String(index % 0x1000).padStart(3, "0")}-8000-${String(index).padStart(12, "0")}`;
            transientIds.push(id);
            log.append(transientEvent(id, String(index)));
        }
        log.append(event(DURABLE));

        const retained = log.since(undefined) ?? [];
        expect(listener).toHaveBeenCalledTimes(10_001);
        expect(retained.filter((entry) => entry.type === "agent_event")).toHaveLength(
            MAX_RETAINED_TRANSIENT_SESSION_EVENTS,
        );
        expect(retained.at(-1)).toEqual(event(DURABLE));
        expect(
            log.since(transientIds.at(-MAX_RETAINED_TRANSIENT_SESSION_EVENTS - 1)),
        ).toBeDefined();
        expect(log.since(transientIds.at(-1))?.map((entry) => entry.id)).toEqual([DURABLE]);
        expect(log.lastEventId()).toBe(DURABLE);
    });
});

function event(id: string): SessionEvent {
    return {
        createdAt: 1_700_000_000_000,
        data: {
            snapshot: {
                id: "agent-1",
                messages: [],
                modelId: "openai/gpt-5.5",
                providerId: "codex",
                queue: [],
                status: "idle",
                tools: [],
            },
        },
        id,
        sessionId: "session-1",
        type: "session_reset",
    };
}

function transientEvent(id: string, delta: string): SessionEvent {
    return {
        createdAt: 1_700_000_000_000,
        data: {
            event: { contentIndex: 0, delta, partial: {}, type: "text_delta" },
            runId: "run-1",
        },
        id,
        sessionId: "session-1",
        type: "agent_event",
    } as SessionEvent;
}
