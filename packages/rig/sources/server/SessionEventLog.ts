import type { EventId, SessionEvent } from "../protocol/index.js";
import { isTransientInferenceSessionEvent } from "./isTransientInferenceSessionEvent.js";

export const MAX_RETAINED_TRANSIENT_SESSION_EVENTS = 256;

export type SessionEventListener = (event: SessionEvent) => void;
export type SessionEventAppendHook = (event: SessionEvent) => void;

export class SessionEventLog {
    #events: SessionEvent[] = [];
    #lastEventId: EventId | undefined;
    #listeners = new Set<SessionEventListener>();
    #omittedEventIds = new Set<EventId>();
    #retainedTransientEventIds: EventId[] = [];
    #onAppend: SessionEventAppendHook | undefined;

    constructor(
        options: {
            events?: readonly SessionEvent[];
            lastEventId?: EventId;
            onAppend?: SessionEventAppendHook;
        } = {},
    ) {
        this.#events = [...(options.events ?? [])];
        this.#retainedTransientEventIds = this.#events
            .filter(isTransientInferenceSessionEvent)
            .map((event) => event.id);
        this.#lastEventId = options.lastEventId ?? this.#events.at(-1)?.id;
        if (
            options.lastEventId !== undefined &&
            !this.#events.some((event) => event.id === options.lastEventId)
        ) {
            this.#rememberOmittedCursor(options.lastEventId);
        }
        this.#onAppend = options.onAppend;
        this.#pruneTransientEvents();
    }

    append(event: SessionEvent): SessionEvent {
        this.#onAppend?.(event);
        this.#events.push(event);
        this.#lastEventId = event.id;
        for (const listener of this.#listeners) {
            listener(event);
        }
        if (isTransientInferenceSessionEvent(event)) {
            this.#retainedTransientEventIds.push(event.id);
            this.#pruneTransientEvents();
        }
        return event;
    }

    firstCreatedAt(): number | undefined {
        return this.#events.at(0)?.createdAt;
    }

    lastEventId(): EventId | undefined {
        return this.#lastEventId;
    }

    lastCreatedAt(): number | undefined {
        return this.#events.at(-1)?.createdAt;
    }

    since(eventId: EventId | undefined): readonly SessionEvent[] | undefined {
        if (eventId === undefined || eventId.length === 0) {
            return [...this.#events];
        }

        const index = this.#events.findIndex((event) => event.id === eventId);
        if (index >= 0) return this.#events.slice(index + 1);

        if (!this.#omittedEventIds.has(eventId)) return undefined;
        return this.#events.filter((event) => event.id > eventId);
    }

    subscribe(listener: SessionEventListener): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    #pruneTransientEvents(): void {
        while (this.#retainedTransientEventIds.length > MAX_RETAINED_TRANSIENT_SESSION_EVENTS) {
            const omittedId = this.#retainedTransientEventIds.shift();
            if (omittedId === undefined) return;
            const index = this.#events.findIndex((event) => event.id === omittedId);
            if (index >= 0) this.#events.splice(index, 1);
            this.#rememberOmittedCursor(omittedId);
        }
    }

    #rememberOmittedCursor(eventId: EventId): void {
        this.#omittedEventIds.add(eventId);
        while (this.#omittedEventIds.size > MAX_RETAINED_TRANSIENT_SESSION_EVENTS) {
            const oldest = this.#omittedEventIds.values().next().value;
            if (oldest === undefined) return;
            this.#omittedEventIds.delete(oldest);
        }
    }
}
