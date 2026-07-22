import {
    createCodeMode,
    type CodeMode,
    type CodeModeContentItem,
    type CodeModeResponse,
    type CodeModeSession,
    type CodeModeTool,
    type JsonValue,
} from "@slopus/rig-codemode-codex";
import { Type } from "@sinclair/typebox";

import type { AgentToolAdaptation, AgentToolAdapter } from "../agent/AgentToolAdapter.js";
import { defineTool, type AnyDefinedTool, type ContentBlock } from "../agent/types.js";
import {
    codeModeGlobalName,
    createCodeModeExecDescription,
} from "./createCodeModeExecDescription.js";
import { parseCodeModeExecInput } from "./parseCodeModeExecInput.js";
import { getCodexCollaborationNamespaceDefinition } from "./getCodexCollaborationNamespaceDefinition.js";
import { getCodeModeNamespaceDescription } from "./getCodeModeNamespaceDescription.js";

const EXEC_GRAMMAR = String.raw`
start: pragma_source | plain_source
pragma_source: PRAGMA_LINE NEWLINE SOURCE
plain_source: SOURCE

PRAGMA_LINE: /[ \t]*\/\/ @exec:[^\r\n]*/
NEWLINE: /\r?\n/
SOURCE: /[\s\S]+/
`;

const WAIT_DESCRIPTION = `Waits on a yielded \`exec\` cell and returns new output or completion.
- Use \`wait\` only after \`exec\` returns \`Script running with cell ID ...\`.
- \`cell_id\` identifies the running \`exec\` cell to resume.
- \`yield_time_ms\` controls how long to wait for more output before yielding again. Defaults to 10000 ms.
- \`max_tokens\` limits how much new output this wait call returns. Defaults to 10000 tokens.
- \`terminate: true\` stops the running cell; false or omitted waits for output.
- \`wait\` returns only the new output since the last yield, or the final completion or termination result for that cell.
- If the cell is still running, \`wait\` may yield again with the same \`cell_id\`.
- If the cell has already finished, \`wait\` returns the completed result and closes the cell.`;

const codeModeResultSchema = Type.Object({
    blocks: Type.Array(
        Type.Union([
            Type.Object({ type: Type.Literal("text"), text: Type.String() }),
            Type.Object({
                type: Type.Literal("image"),
                mediaType: Type.String(),
                data: Type.String(),
                detail: Type.Optional(Type.Union([Type.Literal("high"), Type.Literal("original")])),
            }),
        ]),
    ),
    cellId: Type.String(),
    state: Type.Union([
        Type.Literal("result"),
        Type.Literal("terminated"),
        Type.Literal("yielded"),
    ]),
    errorText: Type.Optional(Type.String()),
});

type CodeModeResult = {
    blocks: ContentBlock[];
    cellId: string;
    errorText?: string;
    state: CodeModeResponse["state"];
};

type NestedToolInvoker = NonNullable<Parameters<AnyDefinedTool["execute"]>[2]["invokeTool"]>;

interface ActiveCellDispatch {
    invokeTool: NestedToolInvoker;
}

interface CellDispatcher {
    current?: ActiveCellDispatch;
}

export interface CodeModeAgentToolAdapterOptions {
    create?: typeof createCodeMode;
    sessionId: string;
}

export class CodeModeAgentToolAdapter implements AgentToolAdapter {
    readonly #create: typeof createCodeMode;
    readonly #cellDispatchers = new Map<string, CellDispatcher>();
    readonly #cellNotificationHandlers = new Map<string, (display: string) => void>();
    readonly #closedCellIds = new Set<string>();
    readonly #notificationHandlers = new Map<string, (display: string) => void>();
    readonly #sessionId: string;
    #closed = false;
    #host: Promise<CodeMode> | undefined;
    #session: Promise<CodeModeSession> | undefined;

    constructor(options: CodeModeAgentToolAdapterOptions) {
        this.#create = options.create ?? createCodeMode;
        this.#sessionId = options.sessionId;
    }

    adapt(tools: readonly AnyDefinedTool[]): AgentToolAdaptation {
        for (const tool of tools) {
            if (tool.codeMode?.namespace !== "collaboration") continue;
            if (tool.execution === "durable") {
                throw new Error(
                    `'collaboration.${tool.name}' cannot be exposed as a durable direct tool.`,
                );
            }
            assertExactCodexCollaborationTool(tool);
        }
        const directTools = tools.filter(
            (tool) => tool.codeMode?.exposure === "direct" || tool.execution === "durable",
        );
        const namespacedTools = tools.filter(
            (tool) => tool.execution !== "durable" && tool.codeMode?.namespace !== undefined,
        );
        const nestedTools = tools
            .filter(
                (tool) =>
                    tool.execution !== "durable" &&
                    tool.codeMode?.exposure !== "direct" &&
                    tool.codeMode?.namespace === undefined,
            )
            .toSorted((left, right) => left.name.localeCompare(right.name));
        const namespaces = [...new Set(namespacedTools.map((tool) => tool.codeMode!.namespace!))];
        return {
            exposedTools: [
                this.#createExecTool(nestedTools),
                this.#createWaitTool(),
                ...directTools,
                ...namespaces.map((namespace) =>
                    this.#createNamespaceTool(
                        namespace,
                        namespacedTools.filter((tool) => tool.codeMode?.namespace === namespace),
                    ),
                ),
            ],
            nestedTools: [...nestedTools, ...namespacedTools],
        };
    }

    async reset(): Promise<void> {
        const session = this.#session;
        this.#session = undefined;
        this.#cellDispatchers.clear();
        this.#cellNotificationHandlers.clear();
        this.#closedCellIds.clear();
        this.#notificationHandlers.clear();
        if (session !== undefined) {
            let createdSession: CodeModeSession;
            try {
                createdSession = await session;
            } catch {
                return;
            }
            await createdSession.close();
        }
    }

    async close(): Promise<void> {
        if (this.#closed) return;
        this.#closed = true;
        const host = this.#host;
        this.#host = undefined;
        this.#session = undefined;
        this.#cellDispatchers.clear();
        this.#cellNotificationHandlers.clear();
        this.#closedCellIds.clear();
        this.#notificationHandlers.clear();
        if (host !== undefined) {
            let createdHost: CodeMode;
            try {
                createdHost = await host;
            } catch {
                return;
            }
            await createdHost.close();
        }
    }

    #createExecTool(tools: readonly AnyDefinedTool[]): AnyDefinedTool {
        const description = createCodeModeExecDescription(tools);
        return defineTool({
            name: "exec",
            label: "exec",
            description,
            providerTool: {
                kind: "custom",
                name: "exec",
                description,
                format: { type: "grammar", syntax: "lark", definition: EXEC_GRAMMAR },
            },
            arguments: Type.Object({ input: Type.String() }),
            returnType: codeModeResultSchema,
            shouldReviewInAutoMode: () => false,
            locks: [],
            execute: async ({ input }, _context, execution): Promise<CodeModeResult> => {
                if (execution.invokeTool === undefined) {
                    throw new Error("Code Mode nested tool dispatch is unavailable.");
                }
                const parsed = parseCodeModeExecInput(input);
                const startedAt = Date.now();
                const toolCallId = execution.toolCallId ?? "exec";
                const dispatcher: CellDispatcher = {
                    current: { invokeTool: execution.invokeTool },
                };
                if (execution.onProgress !== undefined) {
                    this.#notificationHandlers.set(toolCallId, execution.onProgress);
                }
                let response: CodeModeResponse;
                try {
                    response = await (
                        await this.#getSession()
                    ).execute(parsed.code, {
                        maxOutputTokens: parsed.maxOutputTokens ?? 10_000,
                        toolCallId,
                        tools: this.#toCodeModeTools(tools, dispatcher),
                        yieldTimeMs: parsed.yieldTimeMs ?? 10_000,
                        ...(execution.signal === undefined ? {} : { signal: execution.signal }),
                    });
                } finally {
                    delete dispatcher.current;
                    this.#notificationHandlers.delete(toolCallId);
                }
                if (response.state === "yielded" && !this.#closedCellIds.delete(response.cellId)) {
                    this.#cellDispatchers.set(response.cellId, dispatcher);
                } else {
                    this.#closedCellIds.delete(response.cellId);
                }
                return toCodeModeResult(response, startedAt);
            },
            isError: (result) => result.errorText !== undefined,
            toLLM: (result) => result.blocks,
            toUI: (result) => scriptStatus(result),
        });
    }

    #createWaitTool(): AnyDefinedTool {
        return defineTool({
            name: "wait",
            label: "wait",
            description: WAIT_DESCRIPTION,
            arguments: Type.Object({
                cell_id: Type.String({
                    description: "Identifier returned by a yielded exec call.",
                }),
                yield_time_ms: Type.Optional(Type.Number({ minimum: 0 })),
                max_tokens: Type.Optional(Type.Number({ minimum: 0 })),
                terminate: Type.Optional(Type.Boolean()),
            }),
            returnType: codeModeResultSchema,
            shouldReviewInAutoMode: () => false,
            locks: [],
            execute: async (
                { cell_id, max_tokens, terminate, yield_time_ms },
                _context,
                execution,
            ): Promise<CodeModeResult> => {
                const startedAt = Date.now();
                const session = await this.#getSession();
                const dispatcher = this.#cellDispatchers.get(cell_id);
                if (dispatcher !== undefined && execution.invokeTool !== undefined) {
                    dispatcher.current = { invokeTool: execution.invokeTool };
                }
                if (execution.onProgress !== undefined) {
                    this.#cellNotificationHandlers.set(cell_id, execution.onProgress);
                }
                let response: CodeModeResponse;
                try {
                    response = terminate
                        ? await session.terminate(cell_id)
                        : await session.wait(cell_id, yield_time_ms ?? 10_000, execution.signal);
                } finally {
                    if (dispatcher !== undefined) delete dispatcher.current;
                    this.#cellNotificationHandlers.delete(cell_id);
                }
                if (response.state !== "yielded") {
                    this.#cellDispatchers.delete(cell_id);
                    this.#closedCellIds.delete(cell_id);
                }
                const result = toCodeModeResult(response, startedAt);
                return max_tokens === undefined
                    ? result
                    : truncateCodeModeResult(result, max_tokens);
            },
            isError: (result) => result.errorText !== undefined,
            toLLM: (result) => result.blocks,
            toUI: (result) => scriptStatus(result),
        });
    }

    #createNamespaceTool(namespace: string, tools: readonly AnyDefinedTool[]): AnyDefinedTool {
        const description = getCodeModeNamespaceDescription(namespace);
        return defineTool({
            name: namespace,
            label: namespace,
            description,
            providerTool: {
                kind: "namespace",
                name: namespace,
                description,
                tools: tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.arguments,
                })),
            },
            arguments: Type.Object({}),
            returnType: Type.Unknown(),
            shouldReviewInAutoMode: () => false,
            locks: [],
            execute: () => {
                throw new Error(`Namespace '${namespace}' cannot be invoked directly.`);
            },
            toLLM: () => [],
            toUI: () => namespace,
        });
    }

    async #getSession(): Promise<CodeModeSession> {
        if (this.#closed) throw new Error("Code Mode is closed.");
        if (this.#host === undefined) {
            const hostPromise = this.#create().catch((error: unknown) => {
                if (this.#host === hostPromise) this.#host = undefined;
                throw error;
            });
            this.#host = hostPromise;
        }
        const host = this.#host;
        if (this.#session === undefined) {
            const sessionPromise = host
                .then((host) =>
                    host.createSession({
                        sessionId: this.#sessionId,
                        onNotification: (notification) => {
                            const handler =
                                this.#notificationHandlers.get(notification.callId) ??
                                this.#cellNotificationHandlers.get(notification.cellId);
                            handler?.(notification.text);
                        },
                        onCellClosed: (cellId) => {
                            if (!this.#cellDispatchers.delete(cellId)) {
                                this.#closedCellIds.add(cellId);
                            }
                            this.#cellNotificationHandlers.delete(cellId);
                        },
                    }),
                )
                .catch((error: unknown) => {
                    if (this.#session === sessionPromise) this.#session = undefined;
                    throw error;
                });
            this.#session = sessionPromise;
        }
        return this.#session;
    }

    #toCodeModeTools(
        tools: readonly AnyDefinedTool[],
        dispatcher: CellDispatcher,
    ): readonly CodeModeTool[] {
        return tools.map((tool) => ({
            name: codeModeGlobalName(tool),
            toolName: {
                name: tool.name,
                ...(tool.codeMode?.namespace === undefined
                    ? {}
                    : { namespace: tool.codeMode.namespace }),
            },
            description: tool.description,
            kind: tool.codeMode?.kind ?? "function",
            inputSchema: tool.arguments as JsonValue,
            outputSchema: tool.returnType as JsonValue,
            execute: (input, context) => {
                const active = dispatcher.current;
                if (active === undefined) {
                    throw new Error(
                        `Code Mode cell '${context.cellId}' can call tools only while exec or wait is active.`,
                    );
                }
                return active.invokeTool({
                    arguments: tool.codeMode?.toArguments?.(input) ?? input,
                    name: tool.name,
                    ...(tool.codeMode?.namespace === undefined
                        ? {}
                        : { namespace: tool.codeMode.namespace }),
                    signal: context.signal,
                    toolCallId: `codemode:${context.cellId}:${context.runtimeToolCallId}`,
                }) as Promise<JsonValue>;
            },
        }));
    }
}

function assertExactCodexCollaborationTool(tool: AnyDefinedTool): void {
    const definition = getCodexCollaborationNamespaceDefinition(tool.name);
    if (
        definition === undefined ||
        tool.name !== definition.name ||
        tool.description !== definition.description ||
        JSON.stringify(tool.arguments) !== JSON.stringify(definition.parameters)
    ) {
        throw new Error(
            `'collaboration.${tool.name}' must exactly match the official Codex definition.`,
        );
    }
}

function toCodeModeResult(response: CodeModeResponse, startedAt: number): CodeModeResult {
    const header = `${scriptStatus(response)}\nWall time ${((Date.now() - startedAt) / 1_000).toFixed(1)} seconds\nOutput:\n`;
    const blocks: ContentBlock[] = [{ type: "text", text: header }];
    for (const item of response.contentItems) blocks.push(toContentBlock(item));
    if (response.errorText !== undefined) {
        blocks.push({ type: "text", text: `Script error:\n${response.errorText}` });
    }
    return {
        blocks,
        cellId: response.cellId,
        state: response.state,
        ...(response.errorText === undefined ? {} : { errorText: response.errorText }),
    };
}

function toContentBlock(item: CodeModeContentItem): ContentBlock {
    if (item.type === "input_text") return { type: "text", text: item.text };
    if (item.type === "input_audio") {
        return { type: "text", text: "Code Mode produced audio output that Rig cannot render." };
    }
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(item.image_url);
    if (match === null) {
        return { type: "text", text: "Code Mode produced a non-data image URL." };
    }
    return {
        type: "image",
        mediaType: match[1] ?? "application/octet-stream",
        data: match[2] ?? "",
        ...(item.detail === "original" ? { detail: "original" as const } : {}),
    };
}

function scriptStatus(response: Pick<CodeModeResult, "cellId" | "errorText" | "state">): string {
    if (response.state === "yielded") return `Script running with cell ID ${response.cellId}`;
    if (response.state === "terminated") return "Script terminated";
    return response.errorText === undefined ? "Script completed" : "Script failed";
}

function truncateCodeModeResult(result: CodeModeResult, maxTokens: number): CodeModeResult {
    let remaining = Math.max(0, Math.floor(maxTokens * 4));
    const blocks = result.blocks.map((block) => {
        if (block.type !== "text") return block;
        const text = block.text.slice(0, remaining);
        remaining -= text.length;
        return { ...block, text };
    });
    return { ...result, blocks };
}
