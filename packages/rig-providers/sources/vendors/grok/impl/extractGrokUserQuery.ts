import type { SessionMessage } from "@/core/SessionContext.js";

export function extractGrokUserQuery(message: SessionMessage): string | undefined {
    if (message.role !== "user") return undefined;
    const content = message.content.trim();
    if (
        content.startsWith("<user_info>") ||
        content.startsWith("<system-reminder>") ||
        content.startsWith("This session is being continued")
    ) {
        return undefined;
    }
    const match = /^<user_query>\s*([\s\S]*?)\s*<\/user_query>$/u.exec(content);
    return match?.[1]?.trim() ?? content;
}
