import type { ResponseOutputItem } from "openai/resources/responses/responses.js";

import { parseOpenAIToolArguments } from "./parseOpenAIToolArguments.js";
import type { AssistantContent } from "./types.js";

export function toOpenAIResponsesAssistantContent(
    item: ResponseOutputItem,
): AssistantContent | undefined {
    if (item.type === "reasoning") {
        return { type: "thinking", thinking: "" };
    }
    if (item.type === "message") {
        return { type: "text", text: "" };
    }
    if (item.type === "function_call") {
        return {
            type: "toolCall",
            id: item.id === undefined ? item.call_id : `${item.call_id}|${item.id}`,
            name: item.name,
            ...(item.namespace === undefined ? {} : { namespace: item.namespace }),
            arguments: parseOpenAIToolArguments(item.arguments),
        };
    }
    if (item.type === "custom_tool_call") {
        return {
            type: "toolCall",
            id: item.id === undefined ? item.call_id : `${item.call_id}|${item.id}`,
            kind: "custom",
            name: item.name,
            ...(item.namespace === undefined ? {} : { namespace: item.namespace }),
            arguments: { input: item.input },
        };
    }
    if (item.type === "tool_search_call") {
        return {
            type: "toolCall",
            id: item.call_id ?? item.id,
            kind: "tool_search",
            name: "tool_search",
            arguments:
                typeof item.arguments === "object" && item.arguments !== null
                    ? (item.arguments as Record<string, unknown>)
                    : {},
        };
    }
    return undefined;
}
