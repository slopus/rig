import type { SessionEvent } from "../protocol/index.js";

type SubmittedSteeringEvent = Extract<SessionEvent, { type: "message_submitted" }>;

const LEGACY_STARTUP_INTERRUPTION_MESSAGES = new Set([
    "The session was interrupted because the local server stopped before the run completed.",
    "The session was interrupted because the local server shut down before the run completed.",
    "The subagent stopped working because the local server restarted before its suspended run finished.",
]);

export interface LegacyOrphanedSteering {
    events: readonly SubmittedSteeringEvent[];
    runId: string;
}

export function findLegacyOrphanedSteering(
    events: readonly SessionEvent[],
): readonly LegacyOrphanedSteering[] {
    const latestConversationBoundary = events.findLastIndex(
        (event) => event.type === "session_reset" || event.type === "session_rewound",
    );
    const currentEvents = events.slice(latestConversationBoundary + 1);
    const appliedSteering = new Set(
        currentEvents.flatMap((event) =>
            event.type === "steering_applied"
                ? event.data.messageIds.map((messageId) =>
                      JSON.stringify([event.data.runId, messageId]),
                  )
                : [],
        ),
    );
    const seenSubmittedSteering = new Set<string>();
    const startedRunIds = new Set<string>();
    const pendingByRunId = new Map<string, SubmittedSteeringEvent[]>();
    const orphaned: LegacyOrphanedSteering[] = [];

    for (const event of currentEvents) {
        if (event.type === "run_started") {
            startedRunIds.add(event.data.runId);
            pendingByRunId.delete(event.data.runId);
            continue;
        }

        if (event.type === "message_submitted" && event.data.delivery === "steer") {
            if (event.data.source === "notification" || !startedRunIds.has(event.data.runId)) {
                continue;
            }
            const messageId = event.data.message.id;
            const steeringId = JSON.stringify([event.data.runId, messageId]);
            if (appliedSteering.has(steeringId) || seenSubmittedSteering.has(steeringId)) continue;
            seenSubmittedSteering.add(steeringId);
            const pending = pendingByRunId.get(event.data.runId) ?? [];
            pending.push(event);
            pendingByRunId.set(event.data.runId, pending);
            continue;
        }

        if (
            event.type !== "run_finished" &&
            (event.type !== "run_error" ||
                event.data.startupInterruption === true ||
                LEGACY_STARTUP_INTERRUPTION_MESSAGES.has(event.data.errorMessage))
        ) {
            continue;
        }
        const pending = pendingByRunId.get(event.data.runId);
        if (startedRunIds.has(event.data.runId) && pending !== undefined && pending.length > 0) {
            orphaned.push({ events: pending, runId: event.data.runId });
        }
        startedRunIds.delete(event.data.runId);
        pendingByRunId.delete(event.data.runId);
    }

    return orphaned;
}
