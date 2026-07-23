import type {
    ResponseInput,
    ResponseInputItem,
    ResponseReasoningItem,
} from "openai/resources/responses/responses.js";

import type { SessionContext } from "@/core/SessionContext.js";
import type { GrokToolVendor } from "@/vendors/grok/GrokToolVendor.js";
import { toGrokInputContent } from "@/vendors/grok/impl/toGrokInputContent.js";

export function toGrokResponseInput(context: SessionContext): ResponseInput {
    const input: ResponseInput = [
        {
            type: "message",
            role: "system",
            content: context.instructions,
        } as ResponseInputItem,
    ];
    const customToolCallIds = new Set<string>();
    const toolSearchCallIds = new Set<string>();
    for (const message of context.messages) {
        if (message.role === "system") {
            input.push({
                type: "message",
                role: "system",
                content:
                    typeof message.content === "string"
                        ? message.content
                        : message.content.map((text) => ({ type: "input_text", text })),
            });
            continue;
        }
        if (message.role === "user") {
            input.push({
                type: "message",
                role: "user",
                content: toGrokInputContent(message.content, message.input),
            });
            continue;
        }
        if (message.role === "compaction") continue;
        if (message.role === "tool") {
            if (toolSearchCallIds.has(message.callId)) {
                try {
                    const parsed = JSON.parse(message.content) as unknown;
                    input.push({
                        type: "tool_search_output",
                        call_id: message.callId,
                        execution: "client",
                        status: "completed",
                        tools:
                            typeof parsed === "object" &&
                            parsed !== null &&
                            "tools" in parsed &&
                            Array.isArray(parsed.tools)
                                ? parsed.tools
                                : parsed,
                    } as ResponseInputItem);
                } catch {
                    // Ignore malformed opaque tool-search output from an earlier response.
                }
                continue;
            }
            input.push({
                type:
                    customToolCallIds.has(message.callId) ||
                    toolVendorType(message.vendor) === "custom_tool_call"
                        ? "custom_tool_call_output"
                        : "function_call_output",
                call_id: message.callId,
                output: toGrokInputContent(message.content, message.input),
            } as ResponseInputItem);
            continue;
        }

        if (message.responseItems !== undefined) {
            for (const encoded of message.responseItems) {
                try {
                    const item = JSON.parse(encoded) as ResponseInputItem;
                    input.push(item);
                    if (
                        item.type === "tool_search_call" &&
                        item.call_id !== null &&
                        item.call_id !== undefined
                    ) {
                        toolSearchCallIds.add(item.call_id);
                    } else if (item.type === "custom_tool_call") {
                        customToolCallIds.add(item.call_id);
                    }
                } catch {
                    // Ignore malformed opaque response state from an earlier response.
                }
            }
            continue;
        }

        if (message.encryptedReasoning !== undefined) {
            try {
                const reasoning = JSON.parse(message.encryptedReasoning) as ResponseReasoningItem;
                if (reasoning.type === "reasoning") {
                    input.push(reasoning);
                }
            } catch {
                // Ignore malformed opaque reasoning from an earlier response.
            }
        }

        for (const toolCall of message.toolCalls ?? []) {
            const vendorType = toolVendorType(toolCall.vendor);
            if (vendorType === "tool_search_call") {
                try {
                    input.push({
                        type: "tool_search_call",
                        call_id: toolCall.callId,
                        execution: "client",
                        arguments: JSON.parse(toolCall.arguments),
                    } as ResponseInputItem);
                    toolSearchCallIds.add(toolCall.callId);
                } catch {
                    // Ignore malformed tool-search arguments from an earlier response.
                }
            } else if (vendorType === "custom_tool_call") {
                input.push({
                    type: "custom_tool_call",
                    call_id: toolCall.callId,
                    name: toolCall.name,
                    input: toolCall.arguments,
                } as ResponseInputItem);
                customToolCallIds.add(toolCall.callId);
            } else {
                input.push({
                    type: "function_call",
                    call_id: toolCall.callId,
                    name: toolCall.name,
                    arguments: toolCall.arguments,
                } as ResponseInputItem);
            }
        }
        if (message.content.length > 0) {
            input.push({
                type: "message",
                role: "assistant",
                content: message.content,
            } as ResponseInputItem);
        }
    }

    return input;
}

function toolVendorType(vendor: any): GrokToolVendor["type"] | undefined {
    if (typeof vendor !== "object" || vendor === null || vendor.provider !== "grok")
        return undefined;
    return vendor.type === "function_call" ||
        vendor.type === "custom_tool_call" ||
        vendor.type === "tool_search_call"
        ? vendor.type
        : undefined;
}
