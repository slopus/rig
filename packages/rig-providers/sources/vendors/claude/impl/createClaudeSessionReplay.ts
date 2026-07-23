import { createHash } from "node:crypto";

import type {
    Options as ClaudeSdkOptions,
    SDKUserMessage,
    SessionStore,
    SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";

import type {
    SessionAssistantMessage,
    SessionContext,
    SessionImageContent,
    SessionInputContent,
    SessionMessage,
    SessionTextContent,
    SessionToolResultMessage,
    SessionUserMessage,
} from "@/core/SessionContext.js";

export interface ClaudeSessionReplay {
    entries(): readonly SessionStoreEntry[];
    message: SDKUserMessage;
    options: Pick<ClaudeSdkOptions, "persistSession" | "resume" | "sessionStore">;
    prompt: AsyncIterable<SDKUserMessage>;
}

export function createClaudeSessionReplay(options: {
    context: SessionContext;
    cwd: string;
    model: string;
    sessionId: string;
}): ClaudeSessionReplay {
    const splitIndex = findPromptStart(options.context.messages);
    const history = options.context.messages.slice(0, splitIndex);
    const promptMessages = options.context.messages.slice(splitIndex);
    const entries = toSessionStoreEntries(history, options);
    const sessionStore: SessionStore = {
        append: (key, appendedEntries) => {
            if (key.sessionId === options.sessionId) entries.push(...appendedEntries);
            return Promise.resolve();
        },
        load: (key) => Promise.resolve(key.sessionId === options.sessionId ? entries : null),
    };
    const message = toPromptMessage(promptMessages);
    return {
        entries: () => entries,
        message,
        options: { persistSession: true, resume: options.sessionId, sessionStore },
        prompt: singleMessagePrompt(message),
    };
}

export function createClaudeLivePromptMessage(
    messages: readonly SessionMessage[],
): SDKUserMessage {
    let firstTrailingToolIndex = messages.length;
    while (firstTrailingToolIndex > 0 && messages[firstTrailingToolIndex - 1]?.role === "tool") {
        firstTrailingToolIndex -= 1;
    }
    return toPromptMessage(
        firstTrailingToolIndex === messages.length
            ? messages.slice(-1)
            : messages.slice(firstTrailingToolIndex),
    );
}

function findPromptStart(messages: readonly SessionMessage[]): number {
    const lastIndex = Math.max(0, messages.length - 1);
    if (messages[lastIndex]?.role !== "tool") return lastIndex;
    return messages.length;
}

function toPromptMessage(messages: readonly SessionMessage[]): SDKUserMessage {
    const first = messages[0];
    if (first === undefined) {
        return toSdkUserMessage({
            role: "user",
            content: "Continue from the supplied tool result.",
        });
    }
    if (first.role === "user") return toSdkUserMessage(first);
    if (first.role !== "tool") {
        throw new Error("Claude inference must start from a user or tool-result message.");
    }
    return {
        type: "user",
        parent_tool_use_id: null,
        message: {
            role: "user",
            content: messages.map((message) => {
                if (message.role !== "tool") {
                    throw new Error("A Claude tool-result prompt may contain only tool results.");
                }
                return toToolResultBlock(message);
            }),
        },
    };
}

function toSessionStoreEntries(
    messages: readonly SessionMessage[],
    options: { cwd: string; model: string; sessionId: string },
): SessionStoreEntry[] {
    let parentUuid: string | null = null;
    const assistantUuidByToolCallId = new Map<string, string>();
    return messages.flatMap((message, index): SessionStoreEntry[] => {
        if (message.role === "system") return [];
        const uuid = stableMessageUuid(options.sessionId, message, index);
        const base = {
            cwd: options.cwd,
            entrypoint: "sdk-ts",
            isSidechain: false,
            parentUuid,
            sessionId: options.sessionId,
            timestamp: new Date(index).toISOString(),
            userType: "external",
            uuid,
            version: "rig-providers",
        };
        parentUuid = uuid;
        if (message.role === "assistant") {
            for (const call of message.toolCalls ?? []) {
                assistantUuidByToolCallId.set(call.callId, uuid);
            }
            return [
                {
                    ...base,
                    message: toSdkAssistantMessage(message, options.model, uuid),
                    type: "assistant",
                },
            ];
        }
        if (message.role === "tool") {
            const sourceToolAssistantUUID = assistantUuidByToolCallId.get(message.callId);
            return [
                {
                    ...base,
                    isMeta: true,
                    message: { role: "user", content: [toToolResultBlock(message)] },
                    ...(sourceToolAssistantUUID === undefined ? {} : { sourceToolAssistantUUID }),
                    type: "user",
                },
            ];
        }
        return [
            {
                ...base,
                message: {
                    role: "user",
                    content: toSdkContent(
                        message.content,
                        message.role === "user" ? message.input : undefined,
                    ),
                },
                type: "user",
            },
        ];
    });
}

function toSdkUserMessage(message: SessionUserMessage): SDKUserMessage {
    return {
        type: "user",
        parent_tool_use_id: null,
        message: { role: "user", content: toSdkContent(message.content, message.input) },
    };
}

function toSdkAssistantMessage(message: SessionAssistantMessage, model: string, uuid: string) {
    return {
        id: `msg_rig_${uuid.replaceAll("-", "")}`,
        container: null,
        content: [
            ...(message.content.length === 0
                ? []
                : [{ type: "text" as const, text: message.content }]),
            ...(message.toolCalls ?? []).map((call) => ({
                type: "tool_use" as const,
                id: call.callId,
                name: call.name,
                input: parseArguments(call.arguments),
            })),
        ],
        model,
        role: "assistant" as const,
        stop_details: null,
        stop_reason: message.toolCalls?.length ? ("tool_use" as const) : ("end_turn" as const),
        stop_sequence: null,
        type: "message" as const,
        usage: {
            input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 0,
            server_tool_use: null,
            service_tier: null,
            cache_creation: null,
        },
    };
}

function toToolResultBlock(message: SessionToolResultMessage) {
    return {
        type: "tool_result" as const,
        tool_use_id: message.callId,
        content: toSdkContent(message.content, message.input),
    };
}

function toSdkContent(content: string, input?: SessionInputContent) {
    if (input === undefined) return content;
    return input.map(toContentBlock);
}

function toContentBlock(block: SessionTextContent | SessionImageContent) {
    if (block.type === "text") return { type: "text" as const, text: block.text };
    return {
        type: "image" as const,
        source: {
            type: "base64" as const,
            media_type: block.mimeType as ClaudeImageMediaType,
            data: block.data,
        },
    };
}

type ClaudeImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function parseArguments(argumentsJson: string): Record<string, unknown> {
    try {
        const value: unknown = JSON.parse(argumentsJson);
        return value !== null && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

function stableMessageUuid(sessionId: string, message: SessionMessage, index: number): string {
    const digest = createHash("sha256")
        .update(sessionId)
        .update(String(index))
        .update(message.role)
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
