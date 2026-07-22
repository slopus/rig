export type JsonPrimitive = boolean | number | string | null;

export type JsonValue =
    | JsonPrimitive
    | readonly JsonValue[]
    | { readonly [key: string]: JsonValue };

export type CodeModeToolKind = "freeform" | "function";

export type CodeModeSandboxMode = "auto" | "required" | "disabled";

export interface CodeModeToolName {
    readonly name: string;
    readonly namespace?: string;
}

export interface CodeModeToolContext {
    readonly cellId: string;
    readonly runtimeToolCallId: string;
    readonly signal: AbortSignal;
    readonly toolKind: CodeModeToolKind;
    readonly toolName: CodeModeToolName;
}

export interface CodeModeTool {
    readonly name: string;
    readonly toolName?: CodeModeToolName;
    readonly description?: string;
    readonly kind?: CodeModeToolKind;
    readonly inputSchema?: JsonValue;
    readonly outputSchema?: JsonValue;
    execute(
        input: JsonValue | undefined,
        context: CodeModeToolContext,
    ): JsonValue | Promise<JsonValue>;
}

export interface CodeModeNotification {
    readonly callId: string;
    readonly cellId: string;
    readonly text: string;
}

export interface CodeModeContentText {
    readonly type: "input_text";
    readonly text: string;
}

export interface CodeModeContentImage {
    readonly type: "input_image";
    readonly image_url: string;
    readonly detail?: "auto" | "high" | "low" | "original";
}

export interface CodeModeContentAudio {
    readonly type: "input_audio";
    readonly audio_url: string;
}

export type CodeModeContentItem = CodeModeContentAudio | CodeModeContentImage | CodeModeContentText;

export interface CodeModeResponse {
    readonly state: "result" | "terminated" | "yielded";
    readonly cellId: string;
    readonly contentItems: readonly CodeModeContentItem[];
    readonly errorText?: string;
}

export interface CodeModeRunResult {
    readonly state: "result" | "terminated";
    readonly cellId: string;
    readonly contentItems: readonly CodeModeContentItem[];
    readonly errorText?: string;
    readonly responses: readonly CodeModeResponse[];
    readonly text: string;
}

export interface CodeModeSessionOptions {
    readonly onCellClosed?: (cellId: string) => void;
    readonly onNotification?: (notification: CodeModeNotification) => void | Promise<void>;
    readonly sessionId?: string;
    readonly tools?: readonly CodeModeTool[];
}

export interface CodeModeOptions {
    readonly binaryPath?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly sandbox?: CodeModeSandboxMode;
}

export interface CodeModeRunOptions {
    readonly maxOutputTokens?: number;
    readonly signal?: AbortSignal;
    readonly toolCallId?: string;
    readonly tools?: readonly CodeModeTool[];
    readonly yieldTimeMs?: number;
}

export interface RunCodeOptions
    extends CodeModeOptions, CodeModeSessionOptions, CodeModeRunOptions {}
