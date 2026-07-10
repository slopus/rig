import type { Message } from "../types.js";

export function formatMessagesForCompaction(messages: readonly Message[]): string {
    return messages
        .map((message) => {
            const blocks = message.blocks.flatMap((block): string[] => {
                if (block.type === "text") return [block.text];
                if (block.type === "image") return ["[Image shared in the conversation]"];
                if (block.type === "thinking") return [];
                if (block.type === "tool_call") {
                    return [`[Tool call: ${block.name} ${safeJson(block.arguments)}]`];
                }
                const result = block.rendered
                    .map((content) =>
                        content.type === "text" ? content.text : "[Image returned by tool]",
                    )
                    .join("\n");
                return [`[Tool result: ${block.toolName}]\n${result}`];
            });

            return `<message role="${message.role}">\n${blocks.join("\n")}\n</message>`;
        })
        .join("\n\n");
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}
