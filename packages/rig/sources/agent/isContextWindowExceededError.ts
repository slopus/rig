import type { AssistantMessage } from "@slopus/rig-execution";

export function isContextWindowExceededError(value: unknown): boolean {
    if (
        typeof value === "object" &&
        value !== null &&
        "errorCode" in value &&
        (value as { errorCode?: unknown }).errorCode === "context_window_exceeded"
    ) {
        return true;
    }

    let message: string;
    if (
        typeof value === "object" &&
        value !== null &&
        "errorMessage" in value &&
        typeof (value as Pick<AssistantMessage, "errorMessage">).errorMessage === "string"
    ) {
        message = (value as Required<Pick<AssistantMessage, "errorMessage">>).errorMessage;
    } else if (typeof value === "string") {
        message = value;
    } else if (value instanceof Error) {
        message = value.message;
    } else {
        try {
            const serialized = JSON.stringify(value);
            if (typeof serialized !== "string") return false;
            message = serialized;
        } catch {
            return false;
        }
    }

    const normalized = message.toLowerCase();
    return (
        normalized.includes("context_length_exceeded") ||
        normalized.includes("input exceeds the context window") ||
        normalized.includes("context window exceeded") ||
        normalized.includes("maximum context length")
    );
}
