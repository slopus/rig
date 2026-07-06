import { createEventIdFactory } from "../protocol/index.js";
import type {
    ChangeModelRequest,
    CreateSessionRequest,
    SessionSummary,
} from "../protocol/index.js";
import { InMemorySession } from "./InMemorySession.js";
import type { SessionStore } from "./SessionStore.js";

export class InMemorySessionStore implements SessionStore {
    #createEventId = createEventIdFactory();
    #sessions = new Map<string, InMemorySession>();

    create(request: CreateSessionRequest): InMemorySession {
        const session = new InMemorySession({
            createEventId: this.#createEventId,
            request,
        });
        this.#sessions.set(session.id, session);
        return session;
    }

    get(sessionId: string): InMemorySession | undefined {
        return this.#sessions.get(sessionId);
    }

    list(options: { limit?: number } = {}): readonly SessionSummary[] {
        const sessions = [...this.#sessions.values()]
            .map((session) => session.summary())
            .sort((left, right) => sortSummariesByActivity(left, right));
        return options.limit === undefined ? sessions : sessions.slice(0, options.limit);
    }

    changeModel(sessionId: string, request: ChangeModelRequest): InMemorySession | undefined {
        const session = this.get(sessionId);
        if (session === undefined) {
            return undefined;
        }

        session.changeModel(request);
        return session;
    }
}

function sortSummariesByActivity(left: SessionSummary, right: SessionSummary): number {
    return (
        (right.lastMessageAt ?? right.updatedAt) - (left.lastMessageAt ?? left.updatedAt) ||
        right.updatedAt - left.updatedAt
    );
}
