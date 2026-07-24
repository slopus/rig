import type { AssistantMessageEvent } from "@slopus/rig-execution";

export function hasResponseContentBegun(event: AssistantMessageEvent): boolean {
    if (
        event.type === "start" ||
        event.type === "reset" ||
        event.type === "done" ||
        event.type === "error" ||
        event.type === "text_start" ||
        event.type === "thinking_start"
    ) {
        return false;
    }
    if (event.type === "text_delta" || event.type === "thinking_delta") {
        return event.delta.length > 0;
    }
    return true;
}
