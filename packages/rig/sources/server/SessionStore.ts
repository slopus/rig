import type {
    ChangeEffortRequest,
    ChangeModelRequest,
    ChangeServiceTierRequest,
    CreateSessionRequest,
    SubagentSummary,
    SessionSummary,
} from "../protocol/index.js";
import type { InMemorySession } from "./InMemorySession.js";

export interface SessionStore {
    changeEffort(sessionId: string, request: ChangeEffortRequest): InMemorySession | undefined;
    changeModel(sessionId: string, request: ChangeModelRequest): InMemorySession | undefined;
    changeServiceTier(
        sessionId: string,
        request: ChangeServiceTierRequest,
    ): InMemorySession | undefined;
    create(request: CreateSessionRequest): InMemorySession;
    fork(sessionId: string): InMemorySession | undefined;
    get(sessionId: string): InMemorySession | undefined;
    list(options?: { limit?: number }): readonly SessionSummary[];
    listSubagents(parentSessionId: string): readonly SubagentSummary[];
}
