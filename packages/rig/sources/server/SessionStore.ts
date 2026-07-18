import type {
    ChangeEffortRequest,
    ChangeModelRequest,
    ChangeServiceTierRequest,
    CreateSessionRequest,
    RegisterSecretRequest,
    SecretSummary,
    SubagentSummary,
    SessionSummary,
} from "../protocol/index.js";
import type { InMemorySession } from "./InMemorySession.js";
import type { SecretAttachmentScope } from "../secrets/index.js";
import type { ExternalToolCall } from "../external-tools/index.js";

export interface SessionStore {
    attachSecret(
        sessionId: string,
        secretId: string,
        scope: SecretAttachmentScope,
    ): InMemorySession | undefined;
    changeEffort(sessionId: string, request: ChangeEffortRequest): InMemorySession | undefined;
    changeModel(sessionId: string, request: ChangeModelRequest): InMemorySession | undefined;
    changeServiceTier(
        sessionId: string,
        request: ChangeServiceTierRequest,
    ): InMemorySession | undefined;
    create(request: CreateSessionRequest): InMemorySession;
    detachSecret(
        sessionId: string,
        secretId: string,
        scope: SecretAttachmentScope,
    ): InMemorySession | undefined;
    fork(sessionId: string): InMemorySession | undefined;
    get(sessionId: string): InMemorySession | undefined;
    list(options?: { limit?: number }): readonly SessionSummary[];
    listExternalToolCalls(options?: {
        limit?: number;
        status?: ExternalToolCall["status"];
    }): readonly ExternalToolCall[];
    listSubagents(parentSessionId: string): readonly SubagentSummary[];
    listSecrets(): readonly SecretSummary[];
    registerSecret(request: RegisterSecretRequest): SecretSummary;
    unregisterSecret(secretId: string): boolean;
}
