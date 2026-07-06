import type { AgentBlock, AgentMessage, ToolCallBlock } from "./types.js";
import type {
    AssistantContent as ProviderAssistantContent,
    AssistantMessage as ProviderAssistantMessage,
    ToolCall as ProviderToolCall,
} from "../providers/types.js";

export function assistantMessageToAgentMessage(
    message: ProviderAssistantMessage,
    fallbackId: () => string,
): AgentMessage {
    return {
        role: "agent",
        id: message.responseId ?? fallbackId(),
        blocks: message.content.map(providerAssistantContentToAgentBlock),
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
