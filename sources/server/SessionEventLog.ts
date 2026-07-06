import type { EventId, SessionEvent } from "../protocol/index.js";

export type SessionEventListener = (event: SessionEvent) => void;
export type SessionEventAppendHook = (event: SessionEvent) => void;

export class SessionEventLog {
    #events: SessionEvent[] = [];
    #listeners = new Set<SessionEventListener>();
    #onAppend: SessionEventAppendHook | undefined;

    constructor(
        options: { events?: readonly SessionEvent[]; onAppend?: SessionEventAppendHook } = {},
    ) {
        this.#events = [...(options.events ?? [])];
        this.#onAppend = options.onAppend;
    }

    append(event: SessionEvent): SessionEvent {
        this.#onAppend?.(event);
        this.#events.push(event);
        for (const listener of this.#listeners) {
            listener(event);
        }
        return event;
    }

    firstCreatedAt(): number | undefined {
        return this.#events.at(0)?.createdAt;
    }

    lastEventId(): EventId | undefined {
        return this.#events.at(-1)?.id;
    }

    lastCreatedAt(): number | undefined {
        return this.#events.at(-1)?.createdAt;
    }

    since(eventId: EventId | undefined): readonly SessionEvent[] | undefined {
        if (eventId === undefined || eventId.length === 0) {
            return [...this.#events];
        }

        const index = this.#events.findIndex((event) => event.id === eventId);
        if (index < 0) {
            return undefined;
        }

        return this.#events.slice(index + 1);
    }

    subscribe(listener: SessionEventListener): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }
}
