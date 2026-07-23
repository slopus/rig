import type { SessionMessage } from "@/core/SessionContext.js";

export type SessionReasoningEffort =
    | "off"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max";

export type SessionServiceTier = "priority";

export interface SessionRunRequest {
    /** Complete rebuilt conversation context for this inference turn. */
    context: {
        readonly messages: readonly SessionMessage[];
    };
    abort?: AbortSignal;
    model?: string;
    effort?: SessionReasoningEffort;
    serviceTier?: SessionServiceTier;
}
