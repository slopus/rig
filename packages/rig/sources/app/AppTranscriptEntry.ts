import type {
    BackgroundTerminalInteractionPresentation,
    ExecCommandPresentation,
    FileDiff,
} from "../agent/ToolResultPresentation.js";
import type { CodexMcpToolCall } from "./CodexMcpToolCall.js";
import type { CompletedTurn } from "./CompletedTurn.js";
import type { NoticeChild } from "./NoticeChild.js";

export type AppTranscriptRole =
    | "system"
    | "user"
    | "assistant"
    | "thinking"
    | "tool"
    | "event"
    | "error";

export interface AppTranscriptEntry {
    backgroundTerminalCompletion?: string;
    backgroundTerminalInteraction?: BackgroundTerminalInteractionPresentation;
    childText?: boolean;
    completedTurn?: CompletedTurn;
    execCommand?: ExecCommandPresentation;
    fileDiffs?: readonly FileDiff[];
    omittedFileDiffs?: number;
    id: string;
    mcpToolCall?: CodexMcpToolCall;
    noticeChildren?: readonly NoticeChild[];
    permissionReview?: string;
    role: AppTranscriptRole;
    text: string;
    detail?: string;
    title?: string;
    turnElapsedMs?: number;
}
