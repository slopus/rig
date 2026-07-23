export interface SessionTextContent {
    readonly type: "text";
    readonly text: string;
}

export interface SessionImageContent {
    readonly type: "image";
    readonly data: string;
    readonly mimeType: string;
}

export type SessionInputContent = readonly (SessionTextContent | SessionImageContent)[];

export interface SessionUserMessage {
    readonly role: "user";
    readonly content: string;
    /** Ordered multimodal content. When present, providers use this instead of content. */
    readonly input?: SessionInputContent;
}

export interface SessionSystemMessage {
    readonly role: "system";
    readonly content: string | readonly string[];
}

export interface SessionAssistantMessage {
    readonly role: "assistant";
    readonly content: string;
    /** Opaque encrypted reasoning JSON from a prior Responses-compatible response. */
    readonly encryptedReasoning?: string;
    /** Completed client tool calls emitted alongside this assistant message. */
    readonly toolCalls?: readonly SessionToolCall[];
    /**
     * Ordered, opaque Responses output items. Providers use these to replay commentary,
     * reasoning, and parallel tool calls without flattening or reordering them.
     */
    readonly responseItems?: readonly string[];
}

export interface SessionToolCall {
    readonly callId: string;
    readonly name: string;
    readonly namespace?: string;
    readonly arguments: string;
    /** Opaque provider metadata persisted with this tool call. */
    readonly vendor?: any;
}

export interface SessionToolResultMessage {
    readonly role: "tool";
    readonly callId: string;
    readonly content: string;
    /** Ordered multimodal content. When present, providers use this instead of content. */
    readonly input?: SessionInputContent;
    /** Opaque provider metadata persisted with this tool result. */
    readonly vendor?: any;
}

/** Opaque provider-native context checkpoint returned by a compaction request. */
export interface SessionCompactionMessage {
    readonly role: "compaction";
    readonly content: string;
}

export type SessionMessage =
    | SessionSystemMessage
    | SessionUserMessage
    | SessionAssistantMessage
    | SessionToolResultMessage
    | SessionCompactionMessage;

/** Conversation context supplied by the caller for each run or compact. */
export interface SessionContext {
    readonly instructions: string;
    readonly messages: readonly SessionMessage[];
}
