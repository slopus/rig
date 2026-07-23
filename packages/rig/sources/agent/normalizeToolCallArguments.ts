import type { ToolCall as ProviderToolCall } from "@slopus/rig-execution";

import type { AnyDefinedTool } from "./types.js";

export function normalizeToolCallArguments(
    toolCall: ProviderToolCall,
    tool: AnyDefinedTool | undefined,
): ProviderToolCall {
    if (tool?.parseExecutorToolArguments === undefined) return toolCall;
    return {
        ...toolCall,
        arguments: tool.parseExecutorToolArguments(toolCall.arguments),
    };
}
