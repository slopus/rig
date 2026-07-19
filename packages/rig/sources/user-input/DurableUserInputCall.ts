import type { ToolResultBlock } from "../agent/types.js";

import type { UserInputRequest, UserInputResponse } from "./types.js";

export interface DurableUserInputPermission {
    action: string;
    reason: string;
}

export interface DurableUserInputCall {
    batchId: string;
    consumed: boolean;
    createdAt: number;
    kind: "permission" | "question";
    permission?: DurableUserInputPermission;
    request: UserInputRequest;
    response?: UserInputResponse;
    resolvedAt?: number;
    result?: ToolResultBlock;
    runId: string;
    sessionId: string;
    status: "pending" | "answered" | "executing" | "completed" | "cancelled";
    toolArguments: unknown;
    toolCallId: string;
    toolCallIndex: number;
    toolName: string;
}

export interface DurableUserInputOptions {
    batchId: string;
    kind: DurableUserInputCall["kind"];
    permission?: DurableUserInputPermission;
    toolArguments: unknown;
    toolCallId: string;
    toolCallIndex: number;
    toolName: string;
}
