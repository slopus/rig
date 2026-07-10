import {
    createSubagentInstructions,
    findLastAgentResponseText,
    type SpawnSubagentRequest,
    type SpawnSubagentResult,
} from "../agent/index.js";
import type { CreateSessionRequest, SessionAgentMetadata } from "../protocol/index.js";
import type { InMemorySession } from "./InMemorySession.js";

export const DEFAULT_MAX_SUBAGENT_DEPTH = 3;

export interface AgentSessionRepository {
    createSubagent(request: CreateSessionRequest, metadata: SessionAgentMetadata): InMemorySession;
    get(sessionId: string): InMemorySession | undefined;
}

export interface AgentSessionManagerOptions {
    maxDepth?: number;
    repository: AgentSessionRepository;
}

export class AgentSessionManager {
    readonly maxDepth: number;

    readonly #repository: AgentSessionRepository;

    constructor(options: AgentSessionManagerOptions) {
        this.#repository = options.repository;
        this.maxDepth = options.maxDepth ?? DEFAULT_MAX_SUBAGENT_DEPTH;
    }

    taskSession(sessionId: string): InMemorySession | undefined {
        const session = this.#repository.get(sessionId);
        if (session === undefined) return undefined;
        return this.#repository.get(session.agentMetadata().rootSessionId) ?? session;
    }

    async spawn(
        parentSessionId: string,
        request: SpawnSubagentRequest,
        signal?: AbortSignal,
    ): Promise<SpawnSubagentResult> {
        const parent = this.#repository.get(parentSessionId);
        if (parent === undefined) {
            throw new Error("The parent session is no longer available.");
        }

        const parentMetadata = parent.agentMetadata();
        const depth = parentMetadata.depth + 1;
        if (depth > this.maxDepth) {
            throw new Error(`Subagents are limited to ${this.maxDepth} nested levels.`);
        }

        const metadata: SessionAgentMetadata = {
            depth,
            description: request.description,
            parentSessionId,
            ...(request.parentToolCallId !== undefined
                ? { parentToolCallId: request.parentToolCallId }
                : {}),
            rootSessionId: parentMetadata.rootSessionId,
            type: "subagent",
        };
        const parentRequest = parent.requestForSubagent();
        const child = this.#repository.createSubagent(
            {
                ...parentRequest,
                instructions: createSubagentInstructions(
                    parentRequest.instructions,
                    depth,
                    this.maxDepth,
                ),
            },
            metadata,
        );
        const abortChild = () => child.abort();
        signal?.addEventListener("abort", abortChild, { once: true });

        try {
            const submitted = child.submit({ text: request.prompt });
            parent.recordSubagentChanged(child.subagentSummary());
            if (signal?.aborted) {
                child.abort();
            }
            const completion = await child.waitForRun(submitted.runId);
            const summary = child.subagentSummary();
            parent.recordSubagentChanged(summary);
            const output =
                (completion.status === "error" ? completion.errorMessage : undefined) ??
                findLastAgentResponseText(child.snapshot().snapshot.messages) ??
                (completion.status === "aborted"
                    ? "The subagent was stopped before it returned a response."
                    : "The subagent finished without a text response.");
            return {
                output,
                sessionId: child.id,
                status: completion.status,
            };
        } catch (error) {
            child.abort();
            throw error;
        } finally {
            signal?.removeEventListener("abort", abortChild);
        }
    }
}
