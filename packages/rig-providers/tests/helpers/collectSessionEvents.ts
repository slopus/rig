import type { SessionEvent } from "@/core/SessionEvent.js";
import { isSessionErrorDone } from "@/core/SessionEvent.js";
import { committedSessionEvents } from "@/core/committedSessionEvents.js";

export async function collectSessionEvents(
    stream: AsyncIterable<SessionEvent>,
): Promise<SessionEvent[]> {
    const events: SessionEvent[] = [];

    for await (const event of stream) {
        events.push(event);
        if (isSessionErrorDone(event)) {
            throw new Error(`[${event.kind}] ${event.message}`);
        }
    }

    return events;
}

export function textFromSessionEvents(events: readonly SessionEvent[]): string {
    return committedSessionEvents(events)
        .filter(
            (event): event is Extract<SessionEvent, { type: "text_delta" }> =>
                event.type === "text_delta",
        )
        .map((event) => event.delta)
        .join("");
}
