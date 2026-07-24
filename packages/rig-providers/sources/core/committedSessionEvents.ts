import type { SessionEvent } from "@/core/SessionEvent.js";

export function committedSessionEvents(events: readonly SessionEvent[]): SessionEvent[] {
    const committed: SessionEvent[] = [];
    let pending: SessionEvent[] | undefined;
    for (const event of events) {
        if (event.type === "block_start") {
            if (pending !== undefined) throw new Error("A session event block is already open.");
            pending = [];
        } else if (event.type === "block_stop") {
            if (pending === undefined) throw new Error("No session event block is open.");
            committed.push(...pending);
            pending = undefined;
        } else if (event.type === "block_reset") {
            if (pending === undefined) throw new Error("No session event block is open.");
            pending = undefined;
        } else if (pending === undefined) {
            committed.push(event);
        } else {
            pending.push(event);
        }
    }
    return committed;
}
