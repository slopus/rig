import type { AgentBlock, AgentMessage, ToolCallBlock } from "./types.js";
import type {
    AssistantContent as ProviderAssistantContent,
    AssistantMessage as ProviderAssistantMessage,
    ToolCall as ProviderToolCall,
} from "../providers/types.js";

export function assistantMessageToAgentMessage(
    message: ProviderAssistantMessage,
    fallbackId: () => string,
    attribution?: { providerId: string; requestedModelId: string },
): AgentMessage {
    return {
        role: "agent",
        id: message.responseId ?? fallbackId(),
        blocks: message.content.map(providerAssistantContentToAgentBlock),
        usage: message.usage,
        ...(attribution === undefined
            ? {}
            : {
                  providerId: attribution.providerId,
                  requestedModelId: attribution.requestedModelId,
                  ...(message.responseModel === undefined
                      ? {}
                      : { responseModel: message.responseModel }),
              }),
    };
}

function providerAssistantContentToAgentBlock(content: ProviderAssistantContent): AgentBlock {
    if (content.type === "text") {
        return {
            type: "text",
            text: content.text,
        };
    }

    if (content.type === "thinking") {
        return {
            type: "thinking",
            thinking: content.thinking,
            ...(content.encrypted !== undefined ? { encrypted: content.encrypted } : {}),
            ...(content.redacted !== undefined ? { redacted: content.redacted } : {}),
        };
    }

    return providerToolCallToAgentBlock(content);
}

function providerToolCallToAgentBlock(toolCall: ProviderToolCall): ToolCallBlock {
    return {
        type: "tool_call",
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
    };
}
