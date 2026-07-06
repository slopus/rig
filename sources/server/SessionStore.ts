import type {
    ChangeModelRequest,
    CreateSessionRequest,
    SessionSummary,
} from "../protocol/index.js";
import type { InMemorySession } from "./InMemorySession.js";

export interface SessionStore {
    changeModel(sessionId: string, request: ChangeModelRequest): InMemorySession | undefined;
    create(request: CreateSessionRequest): InMemorySession;
    get(sessionId: string): InMemorySession | undefined;
    list(options?: { limit?: number }): readonly SessionSummary[];
}
