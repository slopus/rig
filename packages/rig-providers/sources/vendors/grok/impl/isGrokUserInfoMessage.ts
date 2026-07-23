import type { SessionMessage } from "@/core/SessionContext.js";

export function isGrokUserInfoMessage(message: SessionMessage): boolean {
    return message.role === "user" && message.content.trimStart().startsWith("<user_info>");
}
