import { createEventIdFactory } from "../protocol/index.js";
import type {
    ChangeEffortRequest,
    ChangeModelRequest,
    CreateSessionRequest,
    ModelCatalog,
    SessionSummary,
} from "../protocol/index.js";
import { InMemorySession } from "./InMemorySession.js";
import { createModelCatalog } from "./createModelCatalog.js";
import type { SessionStore } from "./SessionStore.js";

export interface InMemorySessionStoreOptions {
    modelCatalog?: ModelCatalog;
}

export class InMemorySessionStore implements SessionStore {
    #createEventId = createEventIdFactory();
    #modelCatalog: ModelCatalog;
    #sessions = new Map<string, InMemorySession>();

    constructor(options: InMemorySessionStoreOptions = {}) {
        this.#modelCatalog = options.modelCatalog ?? createModelCatalog();
    }

    changeEffort(sessionId: string, request: ChangeEffortRequest): InMemorySession | undefined {
        const session = this.get(sessionId);
        if (session === undefined) {
            return undefined;
        }

        session.changeEffort(request);
        return session;
    }

    create(request: CreateSessionRequest): InMemorySession {
        const session = new InMemorySession({
            createEventId: this.#createEventId,
            modelCatalog: this.#modelCatalog,
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
