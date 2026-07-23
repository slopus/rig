import type { SessionMessage } from "@/core/SessionContext.js";

export function getCodexTurnKey(messages: readonly SessionMessage[]): string {
    const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
    return JSON.stringify(
        messages.slice(0, lastUserIndex < 0 ? messages.length : lastUserIndex + 1),
    );
}
