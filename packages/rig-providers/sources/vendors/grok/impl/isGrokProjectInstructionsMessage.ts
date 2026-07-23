import type { SessionMessage } from "@/core/SessionContext.js";

export function isGrokProjectInstructionsMessage(message: SessionMessage): boolean {
    if (message.role !== "user" || !message.content.trimStart().startsWith("<system-reminder>")) {
        return false;
    }
    return /\bAGENTS\.md\b|project instructions/iu.test(message.content);
}
