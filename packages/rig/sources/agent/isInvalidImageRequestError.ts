import type { AssistantMessage } from "@slopus/rig-execution";

export function isInvalidImageRequestError(value: unknown): boolean {
    if (
        typeof value === "object" &&
        value !== null &&
        "errorCode" in value &&
        (value as Pick<AssistantMessage, "errorCode">).errorCode === "invalid_image_request"
    ) {
        return true;
    }

    if (typeof value === "object" && value !== null && "stopReason" in value) {
        return false;
    }

    let message: string;
    if (typeof value === "string") {
        message = value;
    } else if (value instanceof Error) {
        message = value.message;
    } else {
        try {
            const serialized = JSON.stringify(value);
            if (typeof serialized !== "string") {
                return false;
            }
            message = serialized;
        } catch {
            return false;
        }
    }

    const normalized = message.toLowerCase();
    return (
        normalized.includes("image") &&
        (normalized.includes("does not represent a valid image") ||
            normalized.includes("invalid image") ||
            normalized.includes("unsupported mime type") ||
            (normalized.includes("image_url") && normalized.includes("invalid_value")))
    );
}
