import { Value } from "@sinclair/typebox/value";

import type { AgentContext } from "./context/AgentContext.js";
import type { ToolCallPresentation } from "./ToolCallPresentation.js";
import type { AnyDefinedTool } from "./types.js";
import type { ToolCall as ProviderToolCall } from "@slopus/rig-execution";

export type PresentedToolCall = ProviderToolCall & {
    presentation?: ToolCallPresentation;
};

export function presentToolCall(
    toolCall: ProviderToolCall,
    tools: readonly AnyDefinedTool[],
    context: AgentContext,
): PresentedToolCall {
    const tool = tools.find((candidate) => candidate.name === toolCall.name);
    if (
        tool === undefined ||
        tool.toCallPresentation === undefined ||
        !Value.Check(tool.arguments, toolCall.arguments)
    ) {
        return toolCall;
    }

    try {
        const presentation = tool.toCallPresentation(toolCall.arguments as never, context);
        return presentation === undefined ? toolCall : { ...toolCall, presentation };
    } catch {
        return toolCall;
    }
}
