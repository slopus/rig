import type { TSchema } from "@sinclair/typebox";

/** Where the tool executes: on the provider backend or on the client. */
export type SessionToolType = "cloud" | "local";

/** Lark grammar for OpenAI-style custom tool call syntax. */
export interface SessionToolLarkGrammar {
    readonly type: "lark";
    readonly grammar: string;
}

/** Tool definition supplied to a session. Mapping to provider wire format is vendor-specific. */
export interface SessionTool {
    readonly name: string;
    readonly namespace?: string;
    /** Description of the containing namespace, when this tool is namespaced. */
    readonly namespaceDescription?: string;
    readonly type: SessionToolType;
    readonly description?: string;
    readonly parameters?: TSchema;
    /** Opaque provider metadata persisted with this tool definition. */
    readonly vendor?: any;
    /** Ignored by providers that do not support grammar-based tools. */
    readonly grammar?: SessionToolLarkGrammar;
}

export interface SessionToolsOptions {
    readonly tools?: readonly SessionTool[];
}
