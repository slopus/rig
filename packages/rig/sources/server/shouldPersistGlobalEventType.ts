import type { SessionEvent } from "../protocol/index.js";

export function shouldPersistGlobalEventType(type: SessionEvent["type"]): boolean {
    return type !== "agent_event" && type !== "provider_quota_observed";
}
