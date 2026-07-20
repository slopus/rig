import type { Message } from "../types.js";
import type { ChatHistoryStats } from "../summarizeChatHistory.js";

export type ChatHistoryRole = "assistant" | "system" | "user";

export interface ChatHistoryAgentSummary {
    description?: string;
    messageCount: number;
    path: string;
    sessionId: string;
    status: string;
}

export interface ChatHistoryPage {
    agent: ChatHistoryAgentSummary;
    agents: readonly ChatHistoryAgentSummary[];
    cursor: number;
    matchedMessages: number;
    matchedStats: ChatHistoryStats;
    messages: readonly { message: Message; position: number }[];
    nextCursor?: number;
    previousCursor?: number;
    totalStats: ChatHistoryStats;
    totalMessages: number;
}

export interface ChatHistoryContext {
    read(options: {
        cursor?: number;
        from?: "end" | "start";
        limit: number;
        query?: string;
        roles?: readonly ChatHistoryRole[];
        target?: string;
    }): ChatHistoryPage;
}
