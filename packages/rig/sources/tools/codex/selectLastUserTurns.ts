import type { Message } from "../../agent/types.js";

export function selectLastUserTurns(
    messages: readonly Message[],
    lastNTurns: number | undefined,
): readonly Message[] {
    if (lastNTurns === undefined) return messages;
    const boundaries = messages.flatMap((message, index) =>
        message.role === "user" ? [index] : [],
    );
    const start = boundaries[Math.max(0, boundaries.length - lastNTurns)];
    return start === undefined ? [] : messages.slice(start);
}
