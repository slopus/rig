import type { AssistantMessageEvent } from "../providers/types.js";

export function hasResponseContentBegun(event: AssistantMessageEvent): boolean {
    return event.type !== "start" && event.type !== "done" && event.type !== "error";
}
