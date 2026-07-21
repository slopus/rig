import { eventIdsShareScope, type EventId, type SessionEvent } from "../protocol/index.js";
import { isTransientInferenceSessionEvent } from "./isTransientInferenceSessionEvent.js";

export type SessionEventListener = (event: SessionEvent) => void;
export type SessionEventAppendHook = (event: SessionEvent) => void;

export class SessionEventLog {
    #events: SessionEvent[] = [];
    #firstEventId: EventId | undefined;
    #lastEventId: EventId | undefined;
    #listeners = new Set<SessionEventListener>();
    #messageSubmissions = new Map<string, SessionEvent & { type: "message_submitted" }>();
    #onAppend: SessionEventAppendHook | undefined;

    constructor(
        options: {
            events?: readonly SessionEvent[];
            lastEventId?: EventId;
            onAppend?: SessionEventAppendHook;
        } = {},
    ) {
        this.#events = [...(options.events ?? [])].filter(
            (event) => !isTransientInferenceSessionEvent(event),
        );
        for (const event of this.#events) {
            if (event.type === "message_submitted") {
                this.#messageSubmissions.set(event.data.message.id, event);
            }
        }
        this.#firstEventId = this.#events.at(0)?.id;
        this.#lastEventId = options.lastEventId ?? this.#events.at(-1)?.id;
        this.#onAppend = options.onAppend;
    }

    append(event: SessionEvent): SessionEvent {
        this.#onAppend?.(event);
        if (!isTransientInferenceSessionEvent(event)) {
            this.#events.push(event);
            this.#firstEventId ??= event.id;
            if (event.type === "message_submitted") {
                this.#messageSubmissions.set(event.data.message.id, event);
            }
        }
        this.#lastEventId = event.id;
        for (const listener of this.#listeners) {
            try {
                listener(event);
            } catch {
                // Subscribers are optional observers. A disconnected or broken
                // consumer must not roll back an event that is already durable.
            }
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

    messageSubmission(
        messageId: string,
    ): (SessionEvent & { type: "message_submitted" }) | undefined {
        return this.#messageSubmissions.get(messageId);
    }

    since(eventId: EventId | undefined): readonly SessionEvent[] | undefined {
        if (eventId === undefined || eventId.length === 0) {
            return [...this.#events];
        }

        const index = this.#events.findIndex((event) => event.id === eventId);
        if (index >= 0) return this.#events.slice(index + 1);

        if (
            this.#firstEventId === undefined ||
            this.#lastEventId === undefined ||
            eventId < this.#firstEventId ||
            eventId > this.#lastEventId ||
            !eventIdsShareScope(eventId, this.#lastEventId)
        ) {
            return undefined;
        }
        return this.#events.filter((event) => event.id > eventId);
    }

    subscribe(listener: SessionEventListener): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }
}
