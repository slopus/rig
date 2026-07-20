import type { ChatHistoryPage, ChatHistoryRole } from "./context/ChatHistoryContext.js";
import { messageMatchesChatHistoryFilters } from "./messageMatchesChatHistoryFilters.js";
import { summarizeChatHistory } from "./summarizeChatHistory.js";
import type { Message } from "./types.js";

export function selectChatHistoryPage(
    messages: readonly Message[],
    options: {
        cursor?: number;
        from?: "end" | "start";
        limit: number;
        query?: string;
        roles?: readonly ChatHistoryRole[];
    },
): Pick<
    ChatHistoryPage,
    | "cursor"
    | "matchedMessages"
    | "matchedStats"
    | "messages"
    | "nextCursor"
    | "previousCursor"
    | "totalMessages"
    | "totalStats"
> {
    if (options.cursor !== undefined && options.from !== undefined) {
        throw new Error("Use either cursor or from, not both.");
    }
    const limit = Math.max(1, options.limit);
    const matched = messages
        .map((message, position) => ({ message, position }))
        .filter(({ message }) => messageMatchesChatHistoryFilters(message, options));
    const anchor = Math.min(Math.max(options.cursor ?? 0, 0), messages.length);
    const start =
        options.from === "end"
            ? Math.max(0, matched.length - limit)
            : matched.findIndex((entry) => entry.position >= anchor);
    const startIndex = start < 0 ? matched.length : start;
    const selected = matched.slice(startIndex, startIndex + limit);
    const cursor = selected[0]?.position ?? (options.from === "end" ? messages.length : anchor);
    const next = matched[startIndex + selected.length];
    const previous = matched[Math.max(0, startIndex - limit)];
    return {
        cursor,
        matchedMessages: matched.length,
        matchedStats: summarizeChatHistory(matched.map((entry) => entry.message)),
        messages: selected,
        ...(next === undefined ? {} : { nextCursor: next.position }),
        ...(startIndex === 0 || previous === undefined
            ? {}
            : { previousCursor: previous.position }),
        totalMessages: messages.length,
        totalStats: summarizeChatHistory(messages),
    };
}
