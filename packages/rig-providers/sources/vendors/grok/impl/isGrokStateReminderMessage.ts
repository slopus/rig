import type { SessionMessage } from "@/core/SessionContext.js";
import { isGrokProjectInstructionsMessage } from "@/vendors/grok/impl/isGrokProjectInstructionsMessage.js";

export function isGrokStateReminderMessage(message: SessionMessage): boolean {
    return (
        message.role === "user" &&
        message.content.trimStart().startsWith("<system-reminder>") &&
        !isGrokProjectInstructionsMessage(message)
    );
}
