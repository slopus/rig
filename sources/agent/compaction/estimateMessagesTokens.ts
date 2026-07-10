import type { Message } from "../types.js";

const IMAGE_TOKEN_ESTIMATE = 1_600;
const MESSAGE_OVERHEAD_TOKENS = 8;

export function estimateMessagesTokens(messages: readonly Message[]): number {
    let characters = 0;
    let fixedTokens = messages.length * MESSAGE_OVERHEAD_TOKENS;

    for (const message of messages) {
        for (const block of message.blocks) {
            if (block.type === "image") {
                fixedTokens += IMAGE_TOKEN_ESTIMATE;
            } else if (block.type === "text") {
                characters += block.text.length;
            } else if (block.type === "thinking") {
                characters += block.thinking.length;
            } else if (block.type === "tool_call") {
                characters += block.name.length + safeJson(block.arguments).length;
            } else {
                characters +=
                    block.toolName.length +
                    block.rendered.reduce(
                        (total, content) =>
                            total +
                            (content.type === "text"
                                ? content.text.length
                                : IMAGE_TOKEN_ESTIMATE * 4),
                        0,
                    );
            }
        }
    }

    return fixedTokens + Math.ceil(characters / 4);
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}
