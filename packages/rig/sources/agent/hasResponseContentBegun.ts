import type { AssistantMessageEvent } from "@slopus/rig-execution";

export function hasResponseContentBegun(event: AssistantMessageEvent): boolean {
    if (
        event.type === "start" ||
        event.type === "block_start" ||
        event.type === "block_stop" ||
        event.type === "block_reset" ||
        event.type === "retrying" ||
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
