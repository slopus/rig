import { grokErrorStatus } from "@/vendors/grok/impl/grokRetry.js";

export function isGrokImageStripError(error: unknown): boolean {
    const status = grokErrorStatus(error);
    const message =
        error instanceof Error
            ? error.message
            : typeof error === "object" &&
                error !== null &&
                "message" in error &&
                typeof error.message === "string"
              ? error.message
              : String(error);
    return (
        status === 413 ||
        ((status === 400 || status === 500) && message.includes("Could not process image"))
    );
}
