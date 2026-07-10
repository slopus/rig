import { createEventIdFactory } from "../protocol/index.js";
import type {
    ChangeEffortRequest,
    ChangeModelRequest,
    CreateSessionRequest,
    ModelCatalog,
    SessionAgentMetadata,
    SessionSummary,
    SubagentSummary,
} from "../protocol/index.js";
import { AgentSessionManager } from "./AgentSessionManager.js";
import { InMemorySession } from "./InMemorySession.js";
import { createModelCatalog } from "./createModelCatalog.js";
import type { SessionStore } from "./SessionStore.js";
import type { McpToolProvider } from "../mcp/index.js";

export interface InMemorySessionStoreOptions {
    mcpToolProvider?: McpToolProvider;
    modelCatalog?: ModelCatalog;
}

export class InMemorySessionStore implements SessionStore {
    #agentManager: AgentSessionManager;
    #createEventId = createEventIdFactory();
    #modelCatalog: ModelCatalog;
    #mcpToolProvider: McpToolProvider | undefined;
    #sessions = new Map<string, InMemorySession>();

    constructor(options: InMemorySessionStoreOptions = {}) {
        this.#modelCatalog = options.modelCatalog ?? createModelCatalog();
        this.#mcpToolProvider = options.mcpToolProvider;
        this.#agentManager = new AgentSessionManager({
            repository: {
                createSubagent: (request, metadata) => this.#createSession(request, metadata),
                get: (sessionId) => this.get(sessionId),
                listByRoot: (rootSessionId) =>
                    [...this.#sessions.values()].filter(
                        (session) =>
                            session.agentMetadata().rootSessionId === rootSessionId &&
                            session.isSubagent(),
                    ),
            },
        });
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
        return this.#createSession(request);
    }

    #createSession(
        request: CreateSessionRequest,
        metadata?: SessionAgentMetadata,
    ): InMemorySession {
        const session = new InMemorySession({
            agentManager: this.#agentManager,
            createEventId: this.#createEventId,
            modelCatalog: this.#modelCatalog,
            ...(this.#mcpToolProvider !== undefined
                ? { mcpToolProvider: this.#mcpToolProvider }
                : {}),
            ...(metadata !== undefined ? { metadata } : {}),
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
            .filter((session) => !session.isSubagent())
            .map((session) => session.summary())
            .sort((left, right) => sortSummariesByActivity(left, right));
        return options.limit === undefined ? sessions : sessions.slice(0, options.limit);
    }

    listSubagents(parentSessionId: string): readonly SubagentSummary[] {
        return [...this.#sessions.values()]
            .filter((session) => session.agentMetadata().parentSessionId === parentSessionId)
            .map((session) => session.subagentSummary())
            .sort((left, right) => left.createdAt - right.createdAt);
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
