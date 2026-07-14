import type { FileDiff } from "../agent/ToolResultPresentation.js";
import type { CodexMcpToolCall } from "./CodexMcpToolCall.js";

export type AppTranscriptRole =
    | "system"
    | "user"
    | "assistant"
    | "thinking"
    | "tool"
    | "event"
    | "error"
    | "separator";

export interface AppTranscriptEntry {
    fileDiffs?: readonly FileDiff[];
    omittedFileDiffs?: number;
    id: string;
    mcpToolCall?: CodexMcpToolCall;
    permissionReview?: string;
    role: AppTranscriptRole;
    text: string;
    detail?: string;
    title?: string;
}
