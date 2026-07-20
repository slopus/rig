import type { ChatHistoryPage, Message } from "../agent/index.js";
import { summarizeChatHistory } from "../agent/summarizeChatHistory.js";

const MAX_HISTORY_CHARACTERS = 80_000;

export interface FormattedChatHistoryPage {
    consumedMessages: number;
    history: string;
    startIndex: number;
    stats: ReturnType<typeof summarizeChatHistory>;
}

export function formatChatHistoryPage(
    page: ChatHistoryPage,
    options: { fromEnd?: boolean; includeTools?: boolean } = {},
): FormattedChatHistoryPage {
    const formattedMessages = page.messages.map((entry) =>
        formatMessage(entry.message, entry.position + 1, options.includeTools !== false),
    );
    const selected = selectBoundedMessages(formattedMessages, options.fromEnd === true);
    return {
        consumedMessages: selected.messages.length,
        history: selected.messages.join("\n\n"),
        startIndex: selected.startIndex,
        stats: summarizeChatHistory(
            page.messages
                .slice(selected.startIndex, selected.startIndex + selected.messages.length)
                .map((entry) => entry.message),
        ),
    };
}

function selectBoundedMessages(
    messages: readonly string[],
    fromEnd: boolean,
): { messages: string[]; startIndex: number } {
    const selected: string[] = [];
    let characters = 0;
    const indexes = fromEnd
        ? Array.from({ length: messages.length }, (_, index) => messages.length - index - 1)
        : messages.map((_, index) => index);
    let startIndex = fromEnd ? messages.length : 0;
    for (const index of indexes) {
        const message = messages[index] as string;
        const separatorLength = selected.length === 0 ? 0 : 2;
        const remaining = MAX_HISTORY_CHARACTERS - characters - separatorLength;
        if (selected.length > 0 && message.length > remaining) break;
        const bounded = truncate(message, remaining);
        if (fromEnd) selected.unshift(bounded);
        else selected.push(bounded);
        startIndex = fromEnd ? index : 0;
        characters += separatorLength + bounded.length;
        if (characters >= MAX_HISTORY_CHARACTERS) break;
    }
    return { messages: selected, startIndex };
}

function formatMessage(message: Message, position: number, includeTools: boolean): string {
    const header =
        message.role === "agent"
            ? `${position}. ASSISTANT${message.providerId === undefined ? "" : ` (${message.providerId}${message.requestedModelId === undefined ? "" : `, ${message.requestedModelId}`})`}`
            : `${position}. ${message.role.toUpperCase()}`;
    const lines = [header];
    for (const block of message.blocks) {
        if (block.type === "text") {
            lines.push(`Text: ${truncate(block.text, 12_000)}`);
        } else if (block.type === "image") {
            lines.push(`[Image: ${block.mediaType}]`);
        } else if (block.type === "thinking") {
            lines.push(
                block.redacted === true
                    ? "Thinking: [redacted]"
                    : `Thinking: ${truncate(block.thinking, 12_000)}`,
            );
        } else if (block.type === "tool_call") {
            if (!includeTools) continue;
            lines.push(`Tool call: ${block.name} ${truncateJson(block.arguments, 1_500)}`);
        } else {
            if (!includeTools) continue;
            const output = block.rendered
                .map((rendered) =>
                    rendered.type === "text"
                        ? rendered.text
                        : `[Image output: ${rendered.mediaType}]`,
                )
                .join("\n");
            lines.push(
                `Tool result: ${block.toolName} (${block.isError === true ? "error" : "ok"})\nSummary: ${truncate(block.display, 1_000)}\nOutput: ${truncate(output, 4_000)}`,
            );
        }
    }
    return lines.join("\n");
}

function truncateJson(value: unknown, limit: number): string {
    try {
        return truncate(JSON.stringify(value), limit);
    } catch {
        return "[unserializable arguments]";
    }
}

function truncate(value: string, limit: number): string {
    if (value.length <= limit) return value;
    const suffix = `\n...[truncated ${value.length - limit} chars]`;
    if (suffix.length >= limit) return suffix.slice(0, limit);
    return `${value.slice(0, limit - suffix.length)}${suffix}`;
}
