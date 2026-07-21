import { describe, expect, it, vi } from "vitest";

import { createEventIdFactory, type SessionEvent } from "../protocol/index.js";
import { SessionEventLog } from "./SessionEventLog.js";

const FIRST = "018bcfe5-6800-7001-8000-00000000aaaa";
const OMITTED = "018bcfe5-6800-7002-8000-00000000aaaa";
const DURABLE = "018bcfe5-6800-7003-8000-00000000aaaa";
const OTHER_SESSION = "018bcfe5-6800-7002-8000-00000000bbbb";
const FUTURE = "018bcfe5-6800-7005-8000-00000000aaaa";

describe("SessionEventLog", () => {
    it("isolates subscriber failures from durable event delivery", () => {
        const delivered: SessionEvent[] = [];
        const log = new SessionEventLog();
        log.subscribe(() => {
            throw new Error("disconnected subscriber");
        });
        log.subscribe((next) => delivered.push(next));
        const next = event(FIRST);

        expect(() => log.append(next)).not.toThrow();
        expect(delivered).toEqual([next]);
        expect(log.since(undefined)).toEqual([next]);
    });

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
            lastEventId: DURABLE,
        });

        expect(log.since("not-an-event-id")).toBeUndefined();
        expect(log.since("018bcfe5-6800-7000-8000-000000000000")).toBeUndefined();
        expect(log.since(OTHER_SESSION)).toBeUndefined();
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

    it("indexes durable message submissions from restored and appended events", () => {
        const restored = messageSubmittedEvent(FIRST, "restored-message");
        const appended = messageSubmittedEvent(DURABLE, "appended-message");
        const log = new SessionEventLog({ events: [restored] });

        log.append(appended);

        expect(log.messageSubmission("restored-message")).toEqual(restored);
        expect(log.messageSubmission("appended-message")).toEqual(appended);
        expect(log.messageSubmission("missing-message")).toBeUndefined();
    });

    it("drops transient payloads while preserving delivery, final state, and every scoped cursor", () => {
        const listener = vi.fn();
        const createId = createEventIdFactory({ now: () => 1_700_000_000_000 });
        const first = createId();
        const log = new SessionEventLog({ events: [event(first)] });
        log.subscribe(listener);
        const transientIds: string[] = [];

        for (let index = 0; index < 10_000; index += 1) {
            const id = createId();
            transientIds.push(id);
            log.append(transientEvent(id, String(index)));
        }
        const durable = event(createId());
        log.append(durable);

        const retained = log.since(undefined) ?? [];
        expect(listener).toHaveBeenCalledTimes(10_001);
        expect(retained.filter((entry) => entry.type === "agent_event")).toEqual([]);
        expect(retained.at(-1)).toEqual(durable);
        expect(log.since(transientIds.at(0))?.map((entry) => entry.id)).toEqual([durable.id]);
        expect(log.since(transientIds.at(5_000))?.map((entry) => entry.id)).toEqual([durable.id]);
        expect(log.since(transientIds.at(-1))?.map((entry) => entry.id)).toEqual([durable.id]);
        expect(log.lastEventId()).toBe(durable.id);
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

function messageSubmittedEvent(id: string, messageId: string): SessionEvent {
    return {
        createdAt: 1_700_000_000_000,
        data: {
            delivery: "run",
            displayText: "Continue.",
            message: {
                blocks: [{ text: "Continue.", type: "text" }],
                id: messageId,
                role: "user",
            },
            runId: "run-1",
        },
        id,
        sessionId: "session-1",
        type: "message_submitted",
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
