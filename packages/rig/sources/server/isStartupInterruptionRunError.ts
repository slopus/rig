import type { SessionEvent } from "../protocol/index.js";

const LEGACY_STARTUP_INTERRUPTION_MESSAGES = new Set([
    "The session was interrupted because the local server stopped before the run completed.",
    "The session was interrupted because the local server shut down before the run completed.",
    "The subagent stopped working because the local server restarted before its suspended run finished.",
]);

export function isStartupInterruptionRunError(
    event: Extract<SessionEvent, { type: "run_error" }>,
): boolean {
    return (
        event.data.startupInterruption === true ||
        LEGACY_STARTUP_INTERRUPTION_MESSAGES.has(event.data.errorMessage)
    );
}
