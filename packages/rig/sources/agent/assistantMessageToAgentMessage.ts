import type { ToolCallPresentation } from "./ToolCallPresentation.js";
import type { AgentBlock, AgentMessage, ToolCallBlock } from "./types.js";
import type {
    AssistantContent as ProviderAssistantContent,
    AssistantMessage as ProviderAssistantMessage,
    ToolCall as ProviderToolCall,
} from "../providers/types.js";

export function assistantMessageToAgentMessage(
    message: ProviderAssistantMessage,
    fallbackId: () => string,
    attribution: { providerId: string; requestedModelId: string },
    toToolCallPresentation?: (toolCall: ProviderToolCall) => ToolCallPresentation | undefined,
): AgentMessage {
    return {
        role: "agent",
        id: message.responseId ?? fallbackId(),
        blocks: message.content.map((content) =>
            providerAssistantContentToAgentBlock(content, toToolCallPresentation),
        ),
        usage: message.usage,
        providerId: attribution.providerId,
        requestedModelId: attribution.requestedModelId,
        ...(message.responseModel === undefined ? {} : { responseModel: message.responseModel }),
    };
}

function providerAssistantContentToAgentBlock(
    content: ProviderAssistantContent,
    toToolCallPresentation?: (toolCall: ProviderToolCall) => ToolCallPresentation | undefined,
): AgentBlock {
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

    return providerToolCallToAgentBlock(content, toToolCallPresentation?.(content));
}

function providerToolCallToAgentBlock(
    toolCall: ProviderToolCall,
    presentation: ToolCallPresentation | undefined,
): ToolCallBlock {
    return {
        type: "tool_call",
        id: toolCall.id,
        name: toolCall.name,
        ...(toolCall.namespace === undefined ? {} : { namespace: toolCall.namespace }),
        arguments: toolCall.arguments,
        ...(toolCall.kind === undefined ? {} : { kind: toolCall.kind }),
        ...(presentation === undefined ? {} : { presentation }),
    };
}
