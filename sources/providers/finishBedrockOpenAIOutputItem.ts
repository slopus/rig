import type { ResponseOutputItem } from "openai/resources/responses/responses.js";

import type { ActiveBedrockOpenAIOutputItem } from "./bedrock-openai-types.js";
import { parseOpenAIToolArguments } from "./parseOpenAIToolArguments.js";
import { replaceAssistantContent } from "./replaceAssistantContent.js";
import type {
    AssistantMessage,
    AssistantMessageEvent,
    TextContent,
    ThinkingContent,
    ToolCall,
} from "./types.js";

export function finishBedrockOpenAIOutputItem(
    partial: AssistantMessage,
    activeItem: ActiveBedrockOpenAIOutputItem,
    item: ResponseOutputItem,
): AssistantMessageEvent | undefined {
    const content = partial.content[activeItem.contentIndex];
    if (item.type === "reasoning" && content?.type === "thinking") {
        const summary = item.summary.map((part) => part.text).join("\n\n");
        const reasoning = item.content?.map((part) => part.text).join("\n\n") ?? "";
        const finished: ThinkingContent = {
            ...content,
            thinking: summary || reasoning || content.thinking.trimEnd(),
            encrypted: JSON.stringify(item),
        };
        partial.content = replaceAssistantContent(
            partial.content,
            activeItem.contentIndex,
            finished,
        );
        return {
            type: "thinking_end",
            contentIndex: activeItem.contentIndex,
            content: finished.thinking,
            partial,
        };
    }

    if (item.type === "message" && content?.type === "text") {
        const finished: TextContent = {
            ...content,
            text: item.content
                .map((part) => (part.type === "output_text" ? part.text : part.refusal))
                .join(""),
            textSignature: item.id,
        };
        partial.content = replaceAssistantContent(
            partial.content,
            activeItem.contentIndex,
            finished,
        );
        return {
            type: "text_end",
            contentIndex: activeItem.contentIndex,
            content: finished.text,
            partial,
        };
    }

    if (item.type === "function_call" && content?.type === "toolCall") {
        const finished: ToolCall = {
            ...content,
            id: item.id === undefined ? item.call_id : `${item.call_id}|${item.id}`,
            name: item.name,
            arguments: parseOpenAIToolArguments(item.arguments),
        };
        partial.content = replaceAssistantContent(
            partial.content,
            activeItem.contentIndex,
            finished,
        );
        return {
            type: "toolcall_end",
            contentIndex: activeItem.contentIndex,
            toolCall: finished,
            partial,
        };
    }

    return undefined;
}
