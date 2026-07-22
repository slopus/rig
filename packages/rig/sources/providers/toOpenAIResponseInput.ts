import type {
    ResponseInput,
    ResponseInputItem,
    ResponseOutputMessage,
    ResponseReasoningItem,
} from "openai/resources/responses/responses.js";

import type { Context } from "./types.js";

export function toOpenAIResponseInput(context: Context): ResponseInput {
    const input: ResponseInput = [];
    let fallbackMessageId = 0;
    const customCallIds = new Set(
        context.messages.flatMap((message) =>
            message.role === "assistant"
                ? message.content.flatMap((content) =>
                      content.type === "toolCall" && content.kind === "custom"
                          ? [content.id.split("|")[0] ?? content.id]
                          : [],
                  )
                : [],
        ),
    );

    for (const message of context.messages) {
        if (message.role === "user") {
            const encryptedAgentMessage = message.encryptedAgentMessage;
            if (encryptedAgentMessage !== undefined) {
                input.push({
                    type: "agent_message",
                    author: encryptedAgentMessage.author,
                    recipient: encryptedAgentMessage.recipient,
                    content: [
                        { type: "input_text", text: encryptedAgentMessage.header },
                        {
                            type: "encrypted_content",
                            encrypted_content: encryptedAgentMessage.encryptedContent,
                        },
                    ],
                } as unknown as ResponseInputItem);
                continue;
            }
            input.push({
                role: "user",
                content:
                    typeof message.content === "string"
                        ? message.content
                        : message.content.map((content) =>
                              content.type === "text"
                                  ? { type: "input_text" as const, text: content.text }
                                  : {
                                        type: "input_image" as const,
                                        detail: "auto" as const,
                                        image_url: `data:${content.mimeType};base64,${content.data}`,
                                    },
                          ),
            });
            continue;
        }

        if (message.role === "toolResult") {
            const [callId] = message.toolCallId.split("|");
            const text = message.content
                .filter((content) => content.type === "text")
                .map((content) => content.text)
                .join("\n");
            const images = message.content.filter((content) => content.type === "image");
            input.push({
                type: customCallIds.has(callId ?? message.toolCallId)
                    ? "custom_tool_call_output"
                    : "function_call_output",
                call_id: callId ?? message.toolCallId,
                output:
                    images.length === 0
                        ? text
                        : [
                              ...(text.length > 0 ? [{ type: "input_text" as const, text }] : []),
                              ...images.map((image) => ({
                                  type: "input_image" as const,
                                  detail: "auto" as const,
                                  image_url: `data:${image.mimeType};base64,${image.data}`,
                              })),
                          ],
            });
            continue;
        }

        for (const content of message.content) {
            if (content.type === "thinking") {
                if (content.encrypted === undefined) {
                    continue;
                }
                try {
                    const reasoning = JSON.parse(content.encrypted) as ResponseReasoningItem;
                    if (reasoning.type === "reasoning") {
                        input.push(reasoning);
                    }
                } catch {
                    // Ignore malformed opaque reasoning from an earlier provider response.
                }
                continue;
            }

            if (content.type === "toolCall") {
                const [callId, itemId] = content.id.split("|");
                input.push(
                    content.kind === "custom"
                        ? {
                              type: "custom_tool_call",
                              call_id: callId ?? content.id,
                              ...(itemId !== undefined && itemId.length > 0 ? { id: itemId } : {}),
                              name: content.name,
                              ...(content.namespace === undefined
                                  ? {}
                                  : { namespace: content.namespace }),
                              input:
                                  typeof content.arguments.input === "string"
                                      ? content.arguments.input
                                      : "",
                          }
                        : {
                              type: "function_call",
                              call_id: callId ?? content.id,
                              ...(itemId !== undefined && itemId.length > 0 ? { id: itemId } : {}),
                              name: content.name,
                              ...(content.namespace === undefined
                                  ? {}
                                  : { namespace: content.namespace }),
                              arguments: JSON.stringify(content.arguments),
                          },
                );
                continue;
            }

            const outputMessage: ResponseOutputMessage = {
                type: "message",
                id: content.textSignature ?? `msg_${fallbackMessageId++}`,
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: content.text, annotations: [] }],
            };
            input.push(outputMessage as ResponseInputItem);
        }
    }

    return input;
}
