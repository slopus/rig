import { randomUUID } from "node:crypto";

import type { HostClient } from "./HostClient.js";
import type { HostMessage, WireToolDefinition, WireWaitOutcome } from "./protocol.js";
import { toCodeModeResponse } from "./toCodeModeResponse.js";
import type {
    CodeModeRunOptions,
    CodeModeRunResult,
    CodeModeContentItem,
    CodeModeSessionOptions,
    CodeModeTool,
    CodeModeToolContext,
    CodeModeResponse,
    JsonValue,
} from "./types.js";

type DelegateRequestMessage = Extract<HostMessage, { readonly type: "delegate/request" }>;

export class CodeModeSession {
    private readonly cellTools = new Map<string, Map<string, CodeModeTool>>();
    private closed = false;
    private readonly defaultTools: readonly CodeModeTool[];

    constructor(
        private readonly client: HostClient,
        readonly id: string,
        private readonly options: CodeModeSessionOptions,
        private readonly onClose: () => void,
    ) {
        this.defaultTools = options.tools ?? [];
        this.validateTools(this.defaultTools);
    }

    async execute(source: string, options: CodeModeRunOptions = {}): Promise<CodeModeResponse> {
        this.assertOpen();
        this.throwIfAborted(options.signal);
        const tools = this.mergeTools(options.tools);
        this.validateTools(tools);
        let cellId: string | undefined;
        const abort = () => {
            if (cellId !== undefined) {
                void this.client.terminate(this.id, cellId).catch(() => undefined);
            }
        };
        options.signal?.addEventListener("abort", abort, { once: true });
        try {
            const response = await this.client.execute(
                this.id,
                {
                    tool_call_id: options.toolCallId ?? randomUUID(),
                    enabled_tools: tools.map((tool) => this.toWireTool(tool)),
                    source,
                    yield_time_ms: options.yieldTimeMs ?? null,
                    max_output_tokens: options.maxOutputTokens ?? null,
                },
                (startedCellId) => {
                    cellId = startedCellId;
                    this.cellTools.set(startedCellId, this.indexTools(tools));
                    if (options.signal?.aborted === true) {
                        abort();
                    }
                },
                options.signal,
            );
            this.throwIfAborted(options.signal);
            return toCodeModeResponse(response);
        } finally {
            options.signal?.removeEventListener("abort", abort);
        }
    }

    async wait(
        cellId: string,
        yieldTimeMs = 10_000,
        signal?: AbortSignal,
    ): Promise<CodeModeResponse> {
        this.assertOpen();
        this.throwIfAborted(signal);
        const outcome = await this.client.wait(this.id, cellId, yieldTimeMs, signal);
        this.throwIfAborted(signal);
        return this.unwrapWait(outcome);
    }

    async terminate(cellId: string): Promise<CodeModeResponse> {
        this.assertOpen();
        return this.unwrapWait(await this.client.terminate(this.id, cellId));
    }

    async run(source: string, options: CodeModeRunOptions = {}): Promise<CodeModeRunResult> {
        const responses: CodeModeResponse[] = [];
        const contentItems: CodeModeContentItem[] = [];
        let response = await this.execute(source, options);
        for (;;) {
            responses.push(response);
            contentItems.push(...response.contentItems);
            if (response.state !== "yielded") {
                const text = contentItems
                    .filter(
                        (
                            item,
                        ): item is Extract<(typeof contentItems)[number], { type: "input_text" }> =>
                            item.type === "input_text",
                    )
                    .map((item) => item.text)
                    .join("\n");
                return response.errorText === undefined
                    ? {
                          state: response.state,
                          cellId: response.cellId,
                          contentItems,
                          responses,
                          text,
                      }
                    : {
                          state: response.state,
                          cellId: response.cellId,
                          contentItems,
                          errorText: response.errorText,
                          responses,
                          text,
                      };
            }
            response = await this.wait(
                response.cellId,
                options.yieldTimeMs ?? 10_000,
                options.signal,
            );
        }
    }

    async close(): Promise<void> {
        if (this.closed) {
            return;
        }
        this.closed = true;
        try {
            const response = await this.client.shutdownSession(this.id);
            if (response.type !== "session/closed") {
                throw new Error(`Expected session/closed, received ${response.type}.`);
            }
        } finally {
            this.cellTools.clear();
            this.onClose();
        }
    }

    async handleDelegate(
        message: DelegateRequestMessage,
        signal: AbortSignal,
    ): Promise<
        | { readonly type: "notification/delivered" }
        | { readonly type: "tool/result"; readonly result: JsonValue }
    > {
        if (message.request.type === "notification/send") {
            await this.options.onNotification?.({
                callId: message.request.callId,
                cellId: message.request.cellId,
                text: message.request.text,
            });
            return { type: "notification/delivered" };
        }
        const invocation = message.request.invocation;
        const tools = this.cellTools.get(invocation.cell_id);
        const tool = tools?.get(this.toolKey(invocation.tool_name));
        if (tool === undefined) {
            throw new Error(
                `Code Mode requested an unknown tool: ${this.toolKey(invocation.tool_name)}`,
            );
        }
        const context: CodeModeToolContext = {
            cellId: invocation.cell_id,
            runtimeToolCallId: invocation.runtime_tool_call_id,
            signal,
            toolKind: invocation.tool_kind,
            toolName:
                invocation.tool_name.namespace === null
                    ? { name: invocation.tool_name.name }
                    : {
                          name: invocation.tool_name.name,
                          namespace: invocation.tool_name.namespace,
                      },
        };
        const result = await tool.execute(invocation.input ?? undefined, context);
        return { type: "tool/result", result };
    }

    handleCellClosed(cellId: string): void {
        this.cellTools.delete(cellId);
        this.options.onCellClosed?.(cellId);
    }

    private assertOpen(): void {
        if (this.closed) {
            throw new Error(`Code Mode session ${this.id} is closed.`);
        }
    }

    private indexTools(tools: readonly CodeModeTool[]): Map<string, CodeModeTool> {
        return new Map(
            tools.map((tool) => [
                this.toolKey(tool.toolName ?? { name: tool.name, namespace: null }),
                tool,
            ]),
        );
    }

    private mergeTools(overrides: readonly CodeModeTool[] | undefined): readonly CodeModeTool[] {
        if (overrides === undefined) {
            return this.defaultTools;
        }
        const merged = new Map(this.defaultTools.map((tool) => [tool.name, tool]));
        for (const tool of overrides) {
            merged.set(tool.name, tool);
        }
        return [...merged.values()];
    }

    private throwIfAborted(signal: AbortSignal | undefined): void {
        if (signal?.aborted === true) {
            throw signal.reason instanceof Error
                ? signal.reason
                : new DOMException("Code Mode execution aborted.", "AbortError");
        }
    }

    private toolKey(toolName: {
        readonly name: string;
        readonly namespace?: string | null;
    }): string {
        return `${toolName.namespace ?? ""}\u0000${toolName.name}`;
    }

    private toWireTool(tool: CodeModeTool): WireToolDefinition {
        const toolName = tool.toolName ?? { name: tool.name };
        return {
            name: tool.name,
            tool_name: { name: toolName.name, namespace: toolName.namespace ?? null },
            description: tool.description ?? "",
            kind: tool.kind ?? "function",
            input_schema: tool.inputSchema ?? null,
            output_schema: tool.outputSchema ?? null,
        };
    }

    private unwrapWait(outcome: WireWaitOutcome): CodeModeResponse {
        return toCodeModeResponse("LiveCell" in outcome ? outcome.LiveCell : outcome.MissingCell);
    }

    private validateTools(tools: readonly CodeModeTool[]): void {
        const globalNames = new Set<string>();
        const toolNames = new Set<string>();
        for (const tool of tools) {
            if (tool.name.trim() === "") {
                throw new Error("Code Mode tool names must not be empty.");
            }
            if (!globalNames.add(tool.name)) {
                throw new Error(`Duplicate Code Mode global tool name: ${tool.name}`);
            }
            const key = this.toolKey(tool.toolName ?? { name: tool.name });
            if (!toolNames.add(key)) {
                throw new Error(`Duplicate Code Mode tool identity: ${key.replace("\u0000", "")}`);
            }
        }
    }
}
