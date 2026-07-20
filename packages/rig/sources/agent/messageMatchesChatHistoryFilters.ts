import type { ChatHistoryRole } from "./context/ChatHistoryContext.js";
import type { Message } from "./types.js";

export function messageMatchesChatHistoryFilters(
    message: Message,
    options: { query?: string; roles?: readonly ChatHistoryRole[] },
): boolean {
    const role: ChatHistoryRole = message.role === "agent" ? "assistant" : message.role;
    if (options.roles !== undefined && !options.roles.includes(role)) return false;

    const query = options.query?.trim().toLocaleLowerCase();
    if (query === undefined || query.length === 0) return true;
    return searchableParts(message).some((part) => part.toLocaleLowerCase().includes(query));
}

function searchableParts(message: Message): string[] {
    const parts: string[] = [];
    for (const block of message.blocks) {
        if (block.type === "text") parts.push(block.text);
        else if (block.type === "image") parts.push(block.mediaType);
        else if (block.type === "thinking") parts.push(block.thinking);
        else if (block.type === "tool_call") {
            parts.push(block.name, stringify(block.arguments));
        } else {
            parts.push(block.toolName, block.display);
            for (const rendered of block.rendered) {
                parts.push(rendered.type === "text" ? rendered.text : rendered.mediaType);
            }
            for (const evidence of block.trustedUserEvidence ?? []) {
                parts.push(evidence.type === "text" ? evidence.text : evidence.mediaType);
            }
            if (block.failure?.message !== undefined) parts.push(block.failure.message);
        }
    }
    return parts;
}

function stringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return "";
    }
}
