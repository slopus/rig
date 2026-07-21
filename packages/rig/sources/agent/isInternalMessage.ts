import type { Message } from "./types.js";

export function isInternalMessage(message: Message): boolean {
    return message.internal === true;
}
