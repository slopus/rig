import type { ToolResultBlock, ToolResultFailure } from "./types.js";

export function createErrorToolResultBlock(
    toolCall: { id: string; name: string },
    message: string,
    failure?: ToolResultFailure,
): ToolResultBlock {
    return {
        type: "tool_result",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        rendered: [{ type: "text", text: message }],
        display: message,
        isError: true,
        ...(failure === undefined ? {} : { failure }),
    };
}
