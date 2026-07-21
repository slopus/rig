import { createHash } from "node:crypto";

import type {
    Options as ClaudeSdkOptions,
    SDKUserMessage,
    SessionStore,
    SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import type {
    Base64ImageSource,
    ContentBlockParam,
    ImageBlockParam,
    TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages.js";

import type {
    AssistantMessage,
    Context,
    Message,
    ToolResultMessage,
    ToolResultContent,
    UserContent,
    UserMessage,
} from "./types.js";

export interface ClaudeSessionReplay {
    options: Pick<ClaudeSdkOptions, "persistSession" | "resume" | "sessionStore">;
    prompt: AsyncIterable<SDKUserMessage>;
}

export function createClaudeSessionReplay(options: {
    context: Context;
    cwd: string;
    modelId: string;
    sessionId: string;
}): ClaudeSessionReplay {
    const splitIndex = findPromptStart(options.context.messages);
    const history = options.context.messages.slice(0, splitIndex);
    const promptMessages = options.context.messages.slice(splitIndex);
    const entries = toSessionStoreEntries(history, options);
    const sessionStore: SessionStore = {
        append: () => Promise.resolve(),
        load: (key) => Promise.resolve(key.sessionId === options.sessionId ? entries : null),
    };

    return {
        options: {
            persistSession: true,
            resume: options.sessionId,
            sessionStore,
        },
        prompt: singleMessagePrompt(toPromptMessage(promptMessages)),
    };
}

function findPromptStart(messages: readonly Message[]): number {
    const lastIndex = messages.length - 1;
    const lastMessage = messages[lastIndex];
    if (lastMessage?.role !== "toolResult") return lastIndex;

    let index = lastIndex;
    while (index > 0 && messages[index - 1]?.role === "toolResult") index -= 1;
    return index;
}

function toPromptMessage(messages: readonly Message[]): SDKUserMessage {
    const first = messages[0];
    if (first === undefined) return toSdkUserMessage({ role: "user", content: "", timestamp: 0 });
    if (first.role === "user") return toSdkUserMessage(first);
    if (first.role === "assistant") {
        throw new Error("Claude inference cannot start from an assistant message.");
    }

    return {
        type: "user",
        parent_tool_use_id: null,
        message: {
            role: "user",
            content: messages.map((message) => {
                if (message.role !== "toolResult") {
                    throw new Error("Claude tool-result prompts must contain only tool results.");
                }
                return toToolResultBlock(message);
            }),
        },
        timestamp: new Date(first.timestamp).toISOString(),
    };
}

function toSessionStoreEntries(
    messages: readonly Message[],
    options: { cwd: string; modelId: string; sessionId: string },
): SessionStoreEntry[] {
    let parentUuid: string | null = null;
    const assistantUuidByToolCallId = new Map<string, string>();

    return messages.map((message, index) => {
        const uuid = stableMessageUuid(options.sessionId, message, index);
        const base = {
            cwd: options.cwd,
            entrypoint: "sdk-ts",
            isSidechain: false,
            parentUuid,
            sessionId: options.sessionId,
            timestamp: new Date(message.timestamp).toISOString(),
            userType: "external",
            uuid,
            version: "rig",
        };

        if (message.role === "assistant") {
            for (const block of message.content) {
                if (block.type === "toolCall") assistantUuidByToolCallId.set(block.id, uuid);
            }
            parentUuid = uuid;
            return {
                ...base,
                message: toSdkAssistantMessage(message, options.modelId, uuid),
                requestId: message.responseId,
                type: "assistant",
            };
        }

        if (message.role === "toolResult") {
            const sourceToolAssistantUUID = assistantUuidByToolCallId.get(message.toolCallId);
            parentUuid = uuid;
            return {
                ...base,
                message: { role: "user", content: [toToolResultBlock(message)] },
                ...(sourceToolAssistantUUID === undefined ? {} : { sourceToolAssistantUUID }),
                type: "user",
            };
        }

        parentUuid = uuid;
        return {
            ...base,
            message: toSdkUserMessage(message).message,
            type: "user",
        };
    });
}

function toSdkUserMessage(message: UserMessage): SDKUserMessage {
    return {
        type: "user",
        parent_tool_use_id: null,
        message: {
            role: "user",
            content:
                typeof message.content === "string"
                    ? message.content
                    : message.content.map(toContentBlock),
        },
        timestamp: new Date(message.timestamp).toISOString(),
    };
}

function toSdkAssistantMessage(message: AssistantMessage, modelId: string, uuid: string) {
    const content = message.content.flatMap((block): ContentBlockParam[] => {
        if (block.type === "text") return [{ type: "text", text: block.text }];
        if (block.type === "toolCall") {
            return [
                {
                    type: "tool_use",
                    id: block.id,
                    name: block.name,
                    input: block.arguments,
                },
            ];
        }
        if (block.redacted === true) {
            return block.encrypted === undefined
                ? []
                : [{ type: "redacted_thinking", data: block.encrypted }];
        }
        return block.encrypted === undefined
            ? []
            : [
                  {
                      type: "thinking",
                      thinking: block.thinking,
                      signature: block.encrypted,
                  },
              ];
    });

    return {
        id: message.responseId ?? `msg_rig_${uuid.replaceAll("-", "")}`,
        container: null,
        content,
        model: message.responseModel ?? modelId,
        role: "assistant" as const,
        stop_details: null,
        stop_reason: toClaudeStopReason(message),
        stop_sequence: null,
        type: "message" as const,
        usage: {
            input_tokens: message.usage.input,
            cache_creation_input_tokens: message.usage.cacheWrite,
            cache_read_input_tokens: message.usage.cacheRead,
            output_tokens: message.usage.output,
            server_tool_use: null,
            service_tier: null,
            cache_creation: null,
        },
    };
}

function toClaudeStopReason(message: AssistantMessage) {
    if (message.stopReason === "toolUse") return "tool_use" as const;
    if (message.stopReason === "length") return "max_tokens" as const;
    return "end_turn" as const;
}

function toToolResultBlock(message: ToolResultMessage): ContentBlockParam {
    return {
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content.map(toContentBlock),
        ...(message.isError ? { is_error: true } : {}),
    };
}

function toContentBlock(block: UserContent | ToolResultContent): TextBlockParam | ImageBlockParam {
    if (block.type === "text") return { type: "text", text: block.text };
    return {
        type: "image",
        source: {
            type: "base64",
            media_type: block.mimeType as Base64ImageSource["media_type"],
            data: block.data,
        },
    };
}

function stableMessageUuid(sessionId: string, message: Message, index: number): string {
    const digest = createHash("sha256")
        .update(sessionId)
        .update(String(index))
        .update(message.role)
        .update(String(message.timestamp))
        .digest();
    const bytes = Buffer.from(digest.subarray(0, 16));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function* singleMessagePrompt(message: SDKUserMessage): AsyncIterable<SDKUserMessage> {
    yield message;
}
