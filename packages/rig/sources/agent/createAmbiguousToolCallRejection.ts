import { assistantMessageToAgentMessage } from "./assistantMessageToAgentMessage.js";
import type { AgentMessage, ToolResultBlock } from "./types.js";
import type { AssistantContent, AssistantMessage, ToolCall } from "../providers/types.js";

export interface AmbiguousToolCallRejection {
    assistantMessage: AgentMessage;
    originalToolCallIds: readonly string[];
    resultMessage: AgentMessage;
}

export function createAmbiguousToolCallRejection(
    message: AssistantMessage,
    idFactory: () => string,
    previousToolCallIds: ReadonlySet<string> = new Set(),
): AmbiguousToolCallRejection | undefined {
    const toolCalls = message.content.filter(
        (block): block is ToolCall => block.type === "toolCall",
    );
    const seenIds = new Set<string>();
    let hasReusedId = false;
    for (const toolCall of toolCalls) {
        if (previousToolCallIds.has(toolCall.id) || seenIds.has(toolCall.id)) {
            hasReusedId = true;
            break;
        }
        seenIds.add(toolCall.id);
    }
    if (!hasReusedId) {
        return undefined;
    }

    const safeToolCallIds: string[] = [];
    const safeContent: AssistantContent[] = message.content.map((block) => {
        if (block.type !== "toolCall") return block;
        const id = idFactory();
        safeToolCallIds.push(id);
        return { ...block, id };
    });
    const safeAssistantMessage = assistantMessageToAgentMessage(
        { ...message, content: safeContent },
        idFactory,
    );
    const actionCount = toolCalls.length;
    const rejection =
        `Rig rejected this entire batch of ${String(actionCount)} requested actions because ` +
        "the model reused an action identifier. The requests could not be safely distinguished. " +
        "No tools were run.";
    const resultBlocks: ToolResultBlock[] = toolCalls.map((toolCall, index) => ({
        type: "tool_result",
        toolCallId: safeToolCallIds[index]!,
        toolName: toolCall.name,
        rendered: [{ type: "text", text: rejection }],
        display: rejection,
        isError: true,
    }));

    return {
        assistantMessage: safeAssistantMessage,
        originalToolCallIds: toolCalls.map((toolCall) => toolCall.id),
        resultMessage: {
            role: "agent",
            id: idFactory(),
            blocks: resultBlocks,
        },
    };
}
