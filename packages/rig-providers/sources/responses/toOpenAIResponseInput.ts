import type { ResponseInput, ResponseInputItem } from "openai/resources/responses/responses.js";

import type { SessionContext } from "@/core/SessionContext.js";
import { toOpenAIInputContent } from "@/responses/toOpenAIInputContent.js";
import type { CodexToolVendor } from "@/vendors/codex/CodexToolVendor.js";

export function toOpenAIResponseInput(context: SessionContext): ResponseInput {
    const input: ResponseInput = [];
    const customToolCallIds = new Set<string>();
    const toolSearchCallIds = new Set<string>();
    let messageId = 0;
    for (const message of context.messages) {
        if (message.role === "system") {
            input.push({
                type: "message",
                role: "developer",
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
                content: toOpenAIInputContent(message.content, message.input),
            });
            continue;
        }
        if (message.role === "compaction") {
            input.push({
                type: "compaction",
                encrypted_content: message.content,
            });
            continue;
        }
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
                    // Malformed opaque tool-search output is omitted from replay.
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
                output: toOpenAIInputContent(message.content, message.input),
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
                    // Malformed opaque response state is omitted from replay.
                }
            }
            continue;
        }
        if (message.encryptedReasoning !== undefined) {
            try {
                const item = JSON.parse(message.encryptedReasoning) as ResponseInputItem;
                if (item.type === "reasoning") input.push(item);
            } catch {
                // Opaque reasoning is optional; malformed state must not break the conversation.
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
                    // Malformed tool-search arguments are omitted from replay.
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
                id: `msg_${messageId++}`,
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: message.content, annotations: [] }],
            } as ResponseInputItem);
        }
    }
    return input;
}

function toolVendorType(vendor: any): CodexToolVendor["type"] | undefined {
    if (typeof vendor !== "object" || vendor === null || vendor.provider !== "codex")
        return undefined;
    return vendor.type === "function_call" ||
        vendor.type === "custom_tool_call" ||
        vendor.type === "tool_search_call"
        ? vendor.type
        : undefined;
}
