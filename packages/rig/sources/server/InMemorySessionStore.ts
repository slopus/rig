import { createEventIdFactory } from "../protocol/index.js";
import type { Message } from "../agent/types.js";
import type {
    ChangeEffortRequest,
    ChangeModelRequest,
    ChangeServiceTierRequest,
    CreateSessionRequest,
    ModelCatalog,
    RegisterSecretRequest,
    SecretSummary,
    SessionAgentMetadata,
    SessionSummary,
    SubagentSummary,
} from "../protocol/index.js";
import { AgentSessionManager } from "./AgentSessionManager.js";
import { InMemorySession, type InMemorySessionOptions } from "./InMemorySession.js";
import { createModelCatalog } from "./createModelCatalog.js";
import type { SessionStore } from "./SessionStore.js";
import type { McpToolProvider } from "../mcp/index.js";
import { SecretRegistry, type SecretRegistration } from "../secrets/index.js";
import type { SecretAttachmentScope } from "../secrets/index.js";
import { normalizeProjectCwd } from "./normalizeProjectCwd.js";
import type { ExternalToolCall } from "../external-tools/index.js";

export interface InMemorySessionStoreOptions {
    createRuntime?: InMemorySessionOptions["createRuntime"];
    mcpToolProvider?: McpToolProvider;
    modelCatalog?: ModelCatalog;
    secrets?: readonly SecretRegistration[];
}

export class InMemorySessionStore implements SessionStore {
    #agentManager: AgentSessionManager;
    #createRuntime: InMemorySessionOptions["createRuntime"];
    #modelCatalog: ModelCatalog;
    #mcpToolProvider: McpToolProvider | undefined;
    #projectSecretIds = new Map<string, Set<string>>();
    #secrets: SecretRegistry;
    #sessions = new Map<string, InMemorySession>();

    constructor(options: InMemorySessionStoreOptions = {}) {
        this.#secrets = new SecretRegistry(options.secrets);
        this.#modelCatalog = options.modelCatalog ?? createModelCatalog();
        this.#createRuntime = options.createRuntime;
        this.#mcpToolProvider = options.mcpToolProvider;
        this.#agentManager = new AgentSessionManager({
            repository: {
                createSubagent: (request, metadata, contextMessages) =>
                    this.#createSession(request, metadata, contextMessages),
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

    attachSecret(
        sessionId: string,
        secretId: string,
        scope: SecretAttachmentScope,
    ): InMemorySession | undefined {
        const session = this.get(sessionId);
        if (session === undefined) return undefined;
        this.#secrets.reference(secretId);
        if (scope === "project") {
            const cwd = normalizeProjectCwd(session.snapshot().cwd);
            const ids = this.#projectSecretIds.get(cwd) ?? new Set<string>();
            ids.add(secretId);
            this.#projectSecretIds.set(cwd, ids);
            for (const candidate of this.#sessions.values()) {
                if (normalizeProjectCwd(candidate.snapshot().cwd) === cwd) {
                    candidate.attachSecret(secretId, { scope });
                }
            }
        } else {
            session.attachSecret(secretId, { scope });
        }
        return session;
    }

    changeServiceTier(
        sessionId: string,
        request: ChangeServiceTierRequest,
    ): InMemorySession | undefined {
        const session = this.get(sessionId);
        if (session === undefined) return undefined;
        session.changeServiceTier(request);
        return session;
    }

    create(request: CreateSessionRequest): InMemorySession {
        return this.#createSession(request);
    }

    detachSecret(
        sessionId: string,
        secretId: string,
        scope: SecretAttachmentScope,
    ): InMemorySession | undefined {
        const session = this.get(sessionId);
        if (session === undefined) return undefined;
        if (scope === "project") {
            const cwd = normalizeProjectCwd(session.snapshot().cwd);
            this.#projectSecretIds.get(cwd)?.delete(secretId);
            for (const candidate of this.#sessions.values()) {
                if (normalizeProjectCwd(candidate.snapshot().cwd) === cwd) {
                    candidate.detachSecret(secretId, { scope });
                }
            }
        } else {
            session.detachSecret(secretId, { scope });
        }
        return session;
    }

    fork(sessionId: string): InMemorySession | undefined {
        const source = this.get(sessionId);
        if (source === undefined) return undefined;
        const state = source.createForkState();
        const session = new InMemorySession({
            agentManager: this.#agentManager,
            createEventId: createEventIdFactory(),
            ...(this.#createRuntime === undefined ? {} : { createRuntime: this.#createRuntime }),
            modelCatalog: this.#modelCatalog,
            ...(this.#mcpToolProvider !== undefined
                ? { mcpToolProvider: this.#mcpToolProvider }
                : {}),
            request: source.requestForSubagent(),
            projectSecretIds: this.#projectSecrets(source.snapshot().cwd),
            secretRegistry: this.#secrets,
            restore: state,
        });
        this.#sessions.set(session.id, session);
        session.emitCreatedEvent();
        return session;
    }

    #createSession(
        request: CreateSessionRequest,
        metadata?: SessionAgentMetadata,
        contextMessages?: readonly Message[],
    ): InMemorySession {
        const session = new InMemorySession({
            agentManager: this.#agentManager,
            createEventId: createEventIdFactory(),
            ...(this.#createRuntime === undefined ? {} : { createRuntime: this.#createRuntime }),
            modelCatalog: this.#modelCatalog,
            ...(this.#mcpToolProvider !== undefined
                ? { mcpToolProvider: this.#mcpToolProvider }
                : {}),
            ...(metadata !== undefined ? { metadata } : {}),
            ...(contextMessages !== undefined ? { initialContextMessages: contextMessages } : {}),
            projectSecretIds: this.#projectSecrets(request.cwd),
            request,
            secretRegistry: this.#secrets,
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

    listExternalToolCalls(
        options: { limit?: number; status?: ExternalToolCall["status"] } = {},
    ): readonly ExternalToolCall[] {
        return [...this.#sessions.values()]
            .flatMap((session) =>
                session.externalToolCalls(
                    options.status === undefined ? {} : { status: options.status },
                ),
            )
            .sort((left, right) => left.createdAt - right.createdAt)
            .slice(0, options.limit ?? 100);
    }

    listSubagents(parentSessionId: string): readonly SubagentSummary[] {
        return [...this.#sessions.values()]
            .filter((session) => {
                let ancestorId = session.agentMetadata().parentSessionId;
                while (ancestorId !== undefined) {
                    if (ancestorId === parentSessionId) return true;
                    ancestorId = this.#sessions.get(ancestorId)?.agentMetadata().parentSessionId;
                }
                return false;
            })
            .map((session) => session.subagentSummary())
            .sort((left, right) => left.createdAt - right.createdAt);
    }

    listSecrets(): readonly SecretSummary[] {
        return this.#secrets.references();
    }

    registerSecret(request: RegisterSecretRequest): SecretSummary {
        this.#secrets.register(request);
        return this.#secrets.reference(request.id);
    }

    unregisterSecret(secretId: string): boolean {
        const removed = this.#secrets.unregister(secretId);
        if (!removed) return false;
        for (const ids of this.#projectSecretIds.values()) ids.delete(secretId);
        for (const session of this.#sessions.values()) {
            session.detachSecret(secretId, { scope: "project" });
            session.detachSecret(secretId, { scope: "session" });
        }
        return true;
    }

    changeModel(sessionId: string, request: ChangeModelRequest): InMemorySession | undefined {
        const session = this.get(sessionId);
        if (session === undefined) {
            return undefined;
        }

        session.changeModel(request);
        return session;
    }

    #projectSecrets(cwd: string): readonly string[] {
        return [...(this.#projectSecretIds.get(normalizeProjectCwd(cwd)) ?? [])];
    }
}

function sortSummariesByActivity(left: SessionSummary, right: SessionSummary): number {
    return (
        (right.lastMessageAt ?? right.updatedAt) - (left.lastMessageAt ?? left.updatedAt) ||
        right.updatedAt - left.updatedAt
    );
}
