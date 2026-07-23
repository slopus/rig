import type { SessionCacheUsage } from "@/core/SessionCacheUsage.js";
import type {
    SessionCompactionMessage,
    SessionContext,
    SessionMessage,
} from "@/core/SessionContext.js";

export interface SessionCompactionOptions {
    /** Provider-native instructions describing what the compaction should retain. */
    readonly instructions?: string;
    readonly signal?: AbortSignal;
}

export interface CompletedSessionCompaction {
    readonly status: "completed";
    /** Plain-text summary produced by providers without native compaction. */
    readonly summary?: string;
    /** Opaque checkpoint produced by provider-native compaction. */
    readonly compaction?: SessionCompactionMessage;
    /** Opaque reasoning item emitted while producing the summary, when supported. */
    readonly encryptedReasoning?: string;
    /** Original messages intentionally retained alongside the summary. */
    readonly preservedMessages: readonly SessionMessage[];
    readonly usage?: SessionCacheUsage;
    /** Complete replacement context applied to the session. */
    readonly context: SessionContext;
}

export interface CancelledSessionCompaction {
    readonly status: "cancelled";
    /** Original context left active because compaction did not complete. */
    readonly context: SessionContext;
}

export interface FailedSessionCompaction {
    readonly status: "failed";
    readonly kind: "inference_error" | "invalid_summary" | "tool_call";
    readonly message: string;
    /** Original context left active because compaction did not complete. */
    readonly context: SessionContext;
}

export type SessionCompaction =
    | CompletedSessionCompaction
    | CancelledSessionCompaction
    | FailedSessionCompaction;
