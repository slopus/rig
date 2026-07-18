import type { Message } from "./types.js";

export function collectToolCallIds(messages: readonly Message[]): Set<string> {
    const ids = new Set<string>();
    for (const message of messages) {
        if (message.role !== "agent") continue;
        for (const block of message.blocks) {
            if (block.type === "tool_call") ids.add(block.id);
        }
    }
    return ids;
}
