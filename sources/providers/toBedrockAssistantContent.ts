import type { ResponseOutputItem } from "openai/resources/responses/responses.js";

import { parseOpenAIToolArguments } from "./parseOpenAIToolArguments.js";
import type { AssistantContent } from "./types.js";

export function toBedrockAssistantContent(item: ResponseOutputItem): AssistantContent | undefined {
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
            arguments: parseOpenAIToolArguments(item.arguments),
        };
    }
    return undefined;
}
