import type { SessionContext, SessionInputContent } from "@/core/SessionContext.js";

export function stripGrokContextImages(context: SessionContext): SessionContext | undefined {
    let removed = false;
    const messages = context.messages.map((message) => {
        if ((message.role !== "user" && message.role !== "tool") || message.input === undefined) {
            return message;
        }
        const input = message.input.filter((block) => {
            if (block.type !== "image") return true;
            removed = true;
            return false;
        }) as SessionInputContent;
        return { ...message, input };
    });
    return removed ? { ...context, messages } : undefined;
}
