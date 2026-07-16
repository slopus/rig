import {
    createSdkMcpServer,
    query as defaultClaudeSdkQuery,
    tool as defineSdkTool,
    type EffortLevel,
    type Options as ClaudeSdkOptions,
    type SDKPartialAssistantMessage,
    type SDKResultMessage,
    type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Base64ImageSource, ContentBlockParam } from "@anthropic-ai/sdk/resources/messages.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TSchema } from "@sinclair/typebox";
import { parseStreamingJson } from "@earendil-works/pi-ai";
import { z, type ZodTypeAny } from "zod/v4";

import type { AgentContext, AnyDefinedTool } from "../agent/index.js";
import { errorToMessage } from "../errorToMessage.js";
import { claudeCodeTools } from "../tools/claude/index.js";
import {
    modelAnthropicFable5,
    modelAnthropicHaiku45,
    modelAnthropicOpus46,
    modelAnthropicOpus47,
    modelAnthropicOpus48,
    modelAnthropicSonnet5,
    modelAnthropicSonnet46,
    modelAnthropicSonnet461m,
} from "./models.js";
import { resolveClaudeCodeExecutablePath } from "./resolveClaudeCodeExecutablePath.js";
import { createProviderQuotaCache } from "./createProviderQuotaCache.js";
import { createInferenceStream } from "./createInferenceStream.js";
import { fetchClaudeProviderQuota } from "./fetchClaudeProviderQuota.js";
import { idleClaudeSdkPrompt } from "./idleClaudeSdkPrompt.js";
import { unavailableProviderQuota } from "./unavailableProviderQuota.js";
import {
    defineProvider,
    type AssistantContent,
    type AssistantMessage,
    type AssistantMessageEvent,
    type Context,
    type Model,
    type StopReason,
    type StreamOptions,
    type Tool as ProviderTool,
    type Usage,
    type UserMessage,
} from "./types.js";

const CLAUDE_PROVIDER_ID = "claude";
const RIG_MCP_SERVER_NAME = "rig";
const CLAUDE_SDK_API_NAME = "claude-agent-sdk";

export type ClaudeSdkQuery = typeof defaultClaudeSdkQuery;

export interface ClaudeSdkProviderOptions {
    agentContext: AgentContext;
    env?: NodeJS.ProcessEnv;
    id?: string;
    pathToClaudeCodeExecutable?: string;
    sessionId?: string;
    tools?: readonly AnyDefinedTool[];
    query?: ClaudeSdkQuery;
    now?: () => number;
}

export function createClaudeSdkProvider(options: ClaudeSdkProviderOptions) {
    const query = options.query ?? defaultClaudeSdkQuery;
    const tools = options.tools ?? claudeCodeTools;
    const now = options.now ?? Date.now;
    const pathToClaudeCodeExecutable =
        options.pathToClaudeCodeExecutable ?? resolveClaudeCodeExecutablePath();
    const quota = createProviderQuotaCache(
        async () => {
            try {
                const probe = query({
                    prompt: idleClaudeSdkPrompt(),
                    options: {
                        cwd: options.agentContext.fs.cwd,
                        pathToClaudeCodeExecutable,
                        persistSession: false,
                        settingSources: [],
                    },
                });
                return fetchClaudeProviderQuota(probe, { now });
            } catch {
                return unavailableProviderQuota("claude", now());
            }
        },
        { now },
    );

    return defineProvider({
        id: options.id ?? CLAUDE_PROVIDER_ID,
        imageProfile: () => "claude",
        toolProfile: () => "claude",
        models: [
            modelAnthropicFable5,
            modelAnthropicOpus48,
            modelAnthropicSonnet5,
            modelAnthropicOpus47,
            modelAnthropicOpus46,
            modelAnthropicSonnet461m,
            modelAnthropicSonnet46,
            modelAnthropicHaiku45,
        ],
        quota: (quotaOptions) => quota.get(quotaOptions),
        stream(model, context, streamOptions) {
            const activeTools = toolsForProviderContext(tools, context);
            const sdkOptions = toClaudeSdkOptions({
                agentContext: options.agentContext,
                context,
                env: options.env ?? process.env,
                model,
                pathToClaudeCodeExecutable,
                sessionId: options.sessionId,
                streamOptions,
                tools: activeTools,
            });
            const prompt = toClaudeSdkPrompt(context);

            const run = async function* (): AsyncGenerator<
                AssistantMessageEvent,
                AssistantMessage
            > {
                const partial = createAssistantMessage({
                    model,
                    now,
                    stopReason: "stop",
                });
                yield { type: "start", partial };

                try {
                    const sdkStream = query({ prompt, options: sdkOptions });
                    const streamState = createClaudeStreamState(partial);
                    let result: SDKResultMessage | undefined;

                    for await (const message of sdkStream) {
                        if (message.type === "stream_event") {
                            for (const event of applyClaudeStreamEvent(
                                streamState,
                                message.event,
                            )) {
                                yield event;
                            }

                            if (
                                message.event.type === "message_stop" &&
                                hasClaudeToolCalls(streamState)
                            ) {
                                sdkStream.close();
                                const toolUseMessage = createAssistantMessage({
                                    model,
                                    now,
                                    content: streamState.partial.content,
                                    ...(streamState.partial.responseId !== undefined
                                        ? { responseId: streamState.partial.responseId }
                                        : {}),
                                    ...(streamState.partial.responseModel !== undefined
                                        ? { responseModel: streamState.partial.responseModel }
                                        : {}),
                                    stopReason: "toolUse",
                                    usage: streamState.partial.usage,
                                });
                                yield {
                                    type: "done",
                                    reason: "toolUse",
                                    message: toolUseMessage,
                                };
                                return toolUseMessage;
                            }
                            continue;
                        }

                        if (message.type === "result") {
                            result = message;
                        }
                    }

                    if (result === undefined) {
                        const error = createErrorAssistantMessage({
                            model,
                            now,
                            errorMessage: "Claude SDK finished without returning a result.",
                        });
                        yield { type: "error", reason: "error", error };
                        return error;
                    }

                    if (result.subtype !== "success") {
                        const error = createErrorAssistantMessage({
                            model,
                            now,
                            errorMessage: sdkResultErrorMessage(result),
                            responseId: result.uuid,
                            usage: usageFromClaudeSdkResult(result),
                        });
                        yield { type: "error", reason: "error", error };
                        return error;
                    }

                    const content = result.result;
                    const assistantOptions: Parameters<typeof createAssistantMessage>[0] = {
                        model,
                        now,
                        responseId: result.uuid,
                        stopReason: stopReasonFromClaudeSdkResult(result),
                        text: content,
                        usage: usageFromClaudeSdkResult(result),
                    };
                    const responseModel = responseModelFromResult(result);
                    if (responseModel !== undefined) {
                        assistantOptions.responseModel = responseModel;
                    }
                    const message = createAssistantMessage(assistantOptions);

                    for (const event of finishClaudeStreamState(streamState)) {
                        yield event;
                    }

                    if (!streamState.hasTextContent && content.length > 0) {
                        for (const event of emitFallbackText(streamState, content)) {
                            yield event;
                        }
                    }

                    yield { type: "done", reason: assistantOptions.stopReason, message };
                    return message;
                } catch (error) {
                    const isAborted = streamOptions?.signal?.aborted === true;
                    const assistantMessage = createErrorAssistantMessage({
                        model,
                        now,
                        errorMessage: errorToMessage(error),
                        stopReason: isAborted ? "aborted" : "error",
                    });
                    yield {
                        type: "error",
                        reason: isAborted ? "aborted" : "error",
                        error: assistantMessage,
                    };
                    return assistantMessage;
                }
            };

            return createInferenceStream(run);
        },
    });
}

function toolsForProviderContext(
    tools: readonly AnyDefinedTool[],
    context: Context,
): readonly ProviderTool[] {
    return (
        context.tools ??
        tools.map((tool) => ({
            description: tool.description,
            name: tool.name,
            parameters: tool.arguments,
        }))
    );
}

function toClaudeSdkOptions(options: {
    agentContext: AgentContext;
    context: Context;
    env: NodeJS.ProcessEnv;
    model: Model;
    pathToClaudeCodeExecutable: string;
    sessionId: string | undefined;
    streamOptions: StreamOptions | undefined;
    tools: readonly ProviderTool[];
}): ClaudeSdkOptions {
    const abortController = toAbortController(options.streamOptions?.signal);
    const mcpTools = options.tools.map(toClaudeSdkTool);
    const mcpToolNames = options.tools.map(
        (sourceTool) => `mcp__${RIG_MCP_SERVER_NAME}__${sourceTool.name}`,
    );
    const sdkOptions: ClaudeSdkOptions = {
        // Claude Code permission matching still uses the MCP identity even when
        // the model-visible tool name is unprefixed.
        allowedTools: mcpToolNames,
        cwd: options.agentContext.fs.cwd,
        mcpServers: {
            [RIG_MCP_SERVER_NAME]: createSdkMcpServer({
                name: RIG_MCP_SERVER_NAME,
                instructions:
                    "Use these rig project tools for filesystem, shell, search, and editing work. Claude Code built-in tools are disabled for this session.",
                tools: mcpTools,
                alwaysLoad: true,
            }),
        },
        model: toClaudeSdkModelId(options.model),
        pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
        env: {
            ...options.env,
            CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
            CLAUDE_AGENT_SDK_MCP_NO_PREFIX: "1",
            ...(options.streamOptions?.thinking === "ultra"
                ? { CLAUDE_CODE_EFFORT_LEVEL: "ultracode" }
                : {}),
        },
        extraArgs: {
            "disable-slash-commands": null,
        },
        includePartialMessages: true,
        maxTurns: 1,
        permissionMode: "dontAsk",
        ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
        // Rig persists the conversation. Claude only needs a stable live-session identity.
        persistSession: false,
        settingSources: [],
        skills: [],
        strictMcpConfig: true,
        systemPrompt: options.context.systemPrompt ?? "",
        tools: [],
    };

    if (abortController !== undefined) {
        sdkOptions.abortController = abortController;
    }
    const thinkingOptions = toClaudeSdkThinkingOptions(options.streamOptions?.thinking);
    if (thinkingOptions !== undefined) {
        Object.assign(sdkOptions, thinkingOptions);
    }

    return sdkOptions;
}

function toClaudeSdkTool(sourceTool: ProviderTool) {
    return defineSdkTool(
        sourceTool.name,
        sourceTool.description,
        toZodRawShape(sourceTool.parameters),
        async (): Promise<CallToolResult> =>
            textToolResult("Tool execution is handled by Rig.", true),
        { alwaysLoad: true },
    );
}

function toZodRawShape(schema: TSchema): Record<string, ZodTypeAny> {
    const objectSchema = schema as TSchema & {
        properties?: Record<string, TSchema>;
        required?: string[];
    };
    const properties = objectSchema.properties ?? {};
    const required = new Set(objectSchema.required ?? []);

    return Object.fromEntries(
        Object.entries(properties).map(([key, property]) => {
            const propertySchema = required.has(key)
                ? toZodSchema(property)
                : toZodSchema(property).optional();
            return [key, propertySchema];
        }),
    );
}

function toZodSchema(schema: TSchema): ZodTypeAny {
    const jsonSchema = schema as TSchema & {
        anyOf?: TSchema[];
        const?: unknown;
        description?: string;
        enum?: unknown[];
        items?: TSchema;
        properties?: Record<string, TSchema>;
        required?: string[];
        type?: string;
    };

    let zodSchema: ZodTypeAny;
    if (Object.prototype.hasOwnProperty.call(jsonSchema, "const")) {
        zodSchema = z.literal(toZodLiteralValue(jsonSchema.const));
    } else if (Array.isArray(jsonSchema.enum) && jsonSchema.enum.length > 0) {
        const literals = jsonSchema.enum.map((value) => z.literal(toZodLiteralValue(value)));
        zodSchema = unionZodSchemas(literals);
    } else if (Array.isArray(jsonSchema.anyOf)) {
        zodSchema = unionZodSchemas(jsonSchema.anyOf.map(toZodSchema));
    } else if (jsonSchema.type === "string") {
        zodSchema = z.string();
    } else if (jsonSchema.type === "number" || jsonSchema.type === "integer") {
        zodSchema = z.number();
    } else if (jsonSchema.type === "boolean") {
        zodSchema = z.boolean();
    } else if (jsonSchema.type === "array") {
        zodSchema = z.array(
            jsonSchema.items === undefined ? z.unknown() : toZodSchema(jsonSchema.items),
        );
    } else if (jsonSchema.type === "object") {
        zodSchema = z.object(toZodRawShape(schema));
    } else {
        zodSchema = z.unknown();
    }

    return jsonSchema.description === undefined
        ? zodSchema
        : zodSchema.describe(jsonSchema.description);
}

function unionZodSchemas(schemas: ZodTypeAny[]): ZodTypeAny {
    if (schemas.length === 0) {
        return z.unknown();
    }
    if (schemas.length === 1) {
        return schemas[0] ?? z.unknown();
    }

    return z.union(schemas as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
}

function toZodLiteralValue(value: unknown): string | number | boolean | null {
    if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
    ) {
        return value;
    }

    return String(value);
}

function textToolResult(text: string, isError: boolean): CallToolResult {
    return {
        content: [{ type: "text", text }],
        isError,
    };
}

function toClaudeSdkPrompt(context: Context): string | AsyncIterable<SDKUserMessage> {
    const latestUserMessage = [...context.messages].reverse().find(isUserMessage);
    if (latestUserMessage === undefined) {
        return "";
    }

    if (context.messages.length <= 1) {
        return singleMessagePrompt(toClaudeSdkUserMessage(latestUserMessage));
    }

    return singleMessagePrompt(
        toClaudeSdkTranscriptMessage(context.messages, latestUserMessage.timestamp),
    );
}

async function* singleMessagePrompt(message: SDKUserMessage): AsyncIterable<SDKUserMessage> {
    yield message;
}

function toClaudeSdkUserMessage(message: UserMessage): SDKUserMessage {
    return {
        type: "user",
        parent_tool_use_id: null,
        message: {
            role: "user",
            content:
                typeof message.content === "string"
                    ? message.content
                    : message.content.map(toClaudeContentBlock),
        },
        timestamp: new Date(message.timestamp).toISOString(),
    };
}

function toClaudeSdkTranscriptMessage(
    messages: readonly Context["messages"][number][],
    timestamp: number,
): SDKUserMessage {
    const content: ContentBlockParam[] = [
        {
            type: "text",
            text: "Continue the conversation below. Treat it as prior transcript context and answer the latest user message.\nTool calls with successful matching results are completed actions. Continue from those results without repeating the calls unless the user explicitly asks for a retry.\n\n",
        },
    ];

    for (const message of messages) {
        if (message.role === "user") {
            content.push({ type: "text", text: "User: " });
            if (typeof message.content === "string") {
                content.push({ type: "text", text: message.content });
            } else {
                content.push(...message.content.map(toClaudeContentBlock));
            }
            content.push({ type: "text", text: "\n" });
        } else if (message.role === "assistant") {
            for (const block of message.content) {
                if (block.type === "text") {
                    content.push({ type: "text", text: `Assistant: ${block.text}\n` });
                } else if (block.type === "toolCall") {
                    content.push({
                        type: "text",
                        text: `Assistant tool call ${block.name} (${block.id}): ${JSON.stringify(block.arguments)}\n`,
                    });
                }
            }
        } else {
            const resultStatus = message.isError ? "failed" : "successful";
            content.push({
                type: "text",
                text: `${resultStatus} tool result from ${message.toolName} (${message.toolCallId}): `,
            });
            content.push(...message.content.map(toClaudeContentBlock));
            content.push({ type: "text", text: "\n" });
        }
    }

    if (messages.at(-1)?.role === "toolResult") {
        content.push({
            type: "text",
            text: "\nContinue as the assistant from the completed tool results above. Do not restart the conversation or repeat successful tool calls.",
        });
    }

    return {
        type: "user",
        parent_tool_use_id: null,
        message: {
            role: "user",
            content,
        },
        timestamp: new Date(timestamp).toISOString(),
    };
}

function toClaudeContentBlock(
    content: Extract<UserMessage["content"], readonly unknown[]>[number],
): ContentBlockParam {
    if (content.type === "text") {
        return { type: "text", text: content.text };
    }

    return {
        type: "image",
        source: {
            type: "base64",
            media_type: content.mimeType as Base64ImageSource["media_type"],
            data: content.data,
        },
    };
}

function isUserMessage(message: Context["messages"][number]): message is UserMessage {
    return message.role === "user";
}

function toAbortController(signal: AbortSignal | undefined): AbortController | undefined {
    if (signal === undefined) {
        return undefined;
    }

    const controller = new AbortController();
    if (signal.aborted) {
        controller.abort(signal.reason);
    } else {
        signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }
    return controller;
}

function toClaudeSdkThinkingOptions(
    thinking: string | undefined,
): Pick<ClaudeSdkOptions, "effort" | "thinking"> | undefined {
    if (thinking === undefined) {
        return undefined;
    }
    if (thinking === "off") {
        return { thinking: { type: "disabled" } };
    }
    if (thinking === "ultra") {
        return {
            effort: "xhigh",
            thinking: { type: "adaptive" },
        };
    }
    if (isClaudeSdkEffortLevel(thinking)) {
        return {
            effort: thinking,
            thinking: { type: "adaptive" },
        };
    }

    return undefined;
}

function isClaudeSdkEffortLevel(thinking: string): thinking is EffortLevel {
    return (
        thinking === "low" ||
        thinking === "medium" ||
        thinking === "high" ||
        thinking === "xhigh" ||
        thinking === "max"
    );
}

function toClaudeSdkModelId(model: Model): string {
    const baseModelId =
        model.id === "anthropic/opus-4-8"
            ? "opus"
            : model.id === "anthropic/sonnet-5"
              ? "sonnet"
              : model.id === "anthropic/sonnet-4-6-1m"
                ? "claude-sonnet-4-6"
                : model.id.startsWith("anthropic/")
                  ? `claude-${model.id.slice("anthropic/".length)}`
                  : model.id;
    return model.id.startsWith("anthropic/") && model.contextWindow === 1_000_000
        ? `${baseModelId}[1m]`
        : baseModelId;
}

interface ClaudeTextStreamBlock {
    contentIndex: number;
    ended: boolean;
    text: string;
    type: "text" | "thinking";
}

interface ClaudeToolCallStreamBlock {
    contentIndex: number;
    ended: boolean;
    initialArguments: Record<string, unknown>;
    partialJson: string;
    type: "toolCall";
}

type ClaudeStreamBlock = ClaudeTextStreamBlock | ClaudeToolCallStreamBlock;

type ClaudeContentBlockStartEvent = Extract<
    SDKPartialAssistantMessage["event"],
    { type: "content_block_start" }
>;

type ClaudeContentBlockDeltaEvent = Extract<
    SDKPartialAssistantMessage["event"],
    { type: "content_block_delta" }
>;

interface ClaudeStreamState {
    blocksByRawIndex: Map<number, ClaudeStreamBlock>;
    hasTextContent: boolean;
    partial: AssistantMessage;
}

function createClaudeStreamState(partial: AssistantMessage): ClaudeStreamState {
    return {
        blocksByRawIndex: new Map(),
        hasTextContent: false,
        partial,
    };
}

function applyClaudeStreamEvent(
    state: ClaudeStreamState,
    event: SDKPartialAssistantMessage["event"],
): AssistantMessageEvent[] {
    if (event.type === "message_start") {
        state.partial.responseId = event.message.id;
        state.partial.responseModel = event.message.model;
        updateClaudeUsage(state.partial.usage, event.message.usage);
        return [];
    }

    if (event.type === "message_delta") {
        updateClaudeUsage(state.partial.usage, event.usage);
        return [];
    }

    if (event.type === "content_block_start") {
        return startClaudeContentBlock(state, event.index, event.content_block);
    }

    if (event.type === "content_block_delta") {
        return appendClaudeContentBlockDelta(state, event.index, event.delta);
    }

    if (event.type === "content_block_stop") {
        return finishClaudeContentBlock(state, event.index);
    }

    return [];
}

function startClaudeContentBlock(
    state: ClaudeStreamState,
    rawIndex: number,
    contentBlock: ClaudeContentBlockStartEvent["content_block"],
): AssistantMessageEvent[] {
    if (
        contentBlock.type !== "text" &&
        contentBlock.type !== "thinking" &&
        contentBlock.type !== "tool_use"
    ) {
        return [];
    }

    const contentIndex = state.partial.content.length;
    if (contentBlock.type === "tool_use") {
        const initialArguments = toClaudeToolArguments(contentBlock.input);
        const streamBlock: ClaudeToolCallStreamBlock = {
            contentIndex,
            ended: false,
            initialArguments,
            partialJson: "",
            type: "toolCall",
        };
        state.blocksByRawIndex.set(rawIndex, streamBlock);
        appendPartialContent(state, {
            type: "toolCall",
            id: contentBlock.id,
            name: normalizeClaudeToolName(contentBlock.name),
            arguments: initialArguments,
        });
        return [{ type: "toolcall_start", contentIndex, partial: state.partial }];
    }

    const text = contentBlock.type === "text" ? contentBlock.text : contentBlock.thinking;
    const streamBlock: ClaudeTextStreamBlock = {
        contentIndex,
        ended: false,
        text,
        type: contentBlock.type,
    };
    state.blocksByRawIndex.set(rawIndex, streamBlock);
    appendPartialContent(
        state,
        contentBlock.type === "text"
            ? { type: "text", text }
            : { type: "thinking", thinking: text },
    );

    if (contentBlock.type === "text") {
        state.hasTextContent = true;
        return [
            { type: "text_start", contentIndex, partial: state.partial },
            ...(text.length > 0
                ? [
                      {
                          type: "text_delta" as const,
                          contentIndex,
                          delta: text,
                          partial: state.partial,
                      },
                  ]
                : []),
        ];
    }

    return [
        { type: "thinking_start", contentIndex, partial: state.partial },
        ...(text.length > 0
            ? [
                  {
                      type: "thinking_delta" as const,
                      contentIndex,
                      delta: text,
                      partial: state.partial,
                  },
              ]
            : []),
    ];
}

function appendClaudeContentBlockDelta(
    state: ClaudeStreamState,
    rawIndex: number,
    delta: ClaudeContentBlockDeltaEvent["delta"],
): AssistantMessageEvent[] {
    const block = state.blocksByRawIndex.get(rawIndex);
    if (block === undefined) {
        return [];
    }

    if (delta.type === "text_delta" && block.type === "text") {
        block.text += delta.text;
        state.hasTextContent = true;
        setPartialContent(state, block.contentIndex, { type: "text", text: block.text });
        return [
            {
                type: "text_delta",
                contentIndex: block.contentIndex,
                delta: delta.text,
                partial: state.partial,
            },
        ];
    }

    if (delta.type === "thinking_delta" && block.type === "thinking") {
        block.text += delta.thinking;
        const existing = state.partial.content[block.contentIndex];
        setPartialContent(state, block.contentIndex, {
            type: "thinking",
            thinking: block.text,
            ...(existing?.type === "thinking" && existing.encrypted !== undefined
                ? { encrypted: existing.encrypted }
                : {}),
        });
        return [
            {
                type: "thinking_delta",
                contentIndex: block.contentIndex,
                delta: delta.thinking,
                partial: state.partial,
            },
        ];
    }

    if (delta.type === "signature_delta" && block.type === "thinking") {
        setPartialContent(state, block.contentIndex, {
            type: "thinking",
            thinking: block.text,
            encrypted: delta.signature,
        });
    }

    if (delta.type === "input_json_delta" && block.type === "toolCall") {
        block.partialJson += delta.partial_json;
        const existing = state.partial.content[block.contentIndex];
        if (existing?.type === "toolCall") {
            setPartialContent(state, block.contentIndex, {
                ...existing,
                arguments: parseClaudeToolArguments(block.partialJson, block.initialArguments),
            });
        }
        return [
            {
                type: "toolcall_delta",
                contentIndex: block.contentIndex,
                delta: delta.partial_json,
                partial: state.partial,
            },
        ];
    }

    return [];
}

function finishClaudeContentBlock(
    state: ClaudeStreamState,
    rawIndex: number,
): AssistantMessageEvent[] {
    const block = state.blocksByRawIndex.get(rawIndex);
    if (block === undefined || block.ended) {
        return [];
    }

    block.ended = true;
    if (block.type === "toolCall") {
        const existing = state.partial.content[block.contentIndex];
        if (existing?.type !== "toolCall") {
            return [];
        }
        const toolCall = {
            ...existing,
            arguments: parseClaudeToolArguments(block.partialJson, block.initialArguments),
        };
        setPartialContent(state, block.contentIndex, toolCall);
        return [
            {
                type: "toolcall_end",
                contentIndex: block.contentIndex,
                toolCall,
                partial: state.partial,
            },
        ];
    }

    if (block.type === "text") {
        return [
            {
                type: "text_end",
                contentIndex: block.contentIndex,
                content: block.text,
                partial: state.partial,
            },
        ];
    }

    return [
        {
            type: "thinking_end",
            contentIndex: block.contentIndex,
            content: block.text,
            partial: state.partial,
        },
    ];
}

function finishClaudeStreamState(state: ClaudeStreamState): AssistantMessageEvent[] {
    return [...state.blocksByRawIndex.keys()].flatMap((rawIndex) =>
        finishClaudeContentBlock(state, rawIndex),
    );
}

function hasClaudeToolCalls(state: ClaudeStreamState): boolean {
    return state.partial.content.some((content) => content.type === "toolCall");
}

function normalizeClaudeToolName(name: string): string {
    const mcpPrefix = `mcp__${RIG_MCP_SERVER_NAME}__`;
    return name.startsWith(mcpPrefix) ? name.slice(mcpPrefix.length) : name;
}

function parseClaudeToolArguments(
    partialJson: string,
    fallback: Record<string, unknown>,
): Record<string, unknown> {
    if (partialJson.length === 0) {
        return fallback;
    }

    return toClaudeToolArguments(parseStreamingJson(partialJson), fallback);
}

function toClaudeToolArguments(
    value: unknown,
    fallback: Record<string, unknown> = {},
): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : fallback;
}

function updateClaudeUsage(
    usage: Usage,
    rawUsage: {
        cache_creation_input_tokens?: number | null;
        cache_read_input_tokens?: number | null;
        input_tokens?: number | null;
        output_tokens?: number | null;
    },
): void {
    if (rawUsage.input_tokens != null) usage.input = rawUsage.input_tokens;
    if (rawUsage.output_tokens != null) usage.output = rawUsage.output_tokens;
    if (rawUsage.cache_read_input_tokens != null) {
        usage.cacheRead = rawUsage.cache_read_input_tokens;
    }
    if (rawUsage.cache_creation_input_tokens != null) {
        usage.cacheWrite = rawUsage.cache_creation_input_tokens;
    }
    usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function emitFallbackText(state: ClaudeStreamState, text: string): AssistantMessageEvent[] {
    const contentIndex = state.partial.content.length;
    appendPartialContent(state, { type: "text", text });
    state.hasTextContent = true;
    return [
        { type: "text_start", contentIndex, partial: state.partial },
        {
            type: "text_delta",
            contentIndex,
            delta: text,
            partial: state.partial,
        },
        {
            type: "text_end",
            contentIndex,
            content: text,
            partial: state.partial,
        },
    ];
}

function appendPartialContent(state: ClaudeStreamState, content: AssistantContent): void {
    state.partial.content = [...state.partial.content, content];
}

function setPartialContent(
    state: ClaudeStreamState,
    contentIndex: number,
    content: AssistantContent,
): void {
    const nextContent = [...state.partial.content];
    nextContent[contentIndex] = content;
    state.partial.content = nextContent;
}

function createAssistantMessage(options: {
    model: Model;
    now: () => number;
    content?: readonly AssistantContent[];
    responseId?: string;
    responseModel?: string;
    stopReason: Extract<StopReason, "stop" | "length" | "toolUse">;
    text?: string;
    usage?: Usage;
}): AssistantMessage {
    return {
        role: "assistant",
        api: CLAUDE_SDK_API_NAME,
        provider: CLAUDE_PROVIDER_ID,
        model: options.model.id,
        content:
            options.content ??
            (options.text === undefined || options.text.length === 0
                ? []
                : [{ type: "text", text: options.text }]),
        usage: options.usage ?? zeroUsage(),
        stopReason: options.stopReason,
        timestamp: options.now(),
        ...(options.responseId !== undefined ? { responseId: options.responseId } : {}),
        ...(options.responseModel !== undefined ? { responseModel: options.responseModel } : {}),
    };
}

function createErrorAssistantMessage(options: {
    model: Model;
    now: () => number;
    errorMessage: string;
    responseId?: string;
    stopReason?: Extract<StopReason, "aborted" | "error">;
    usage?: Usage;
}): AssistantMessage {
    return {
        role: "assistant",
        api: CLAUDE_SDK_API_NAME,
        provider: CLAUDE_PROVIDER_ID,
        model: options.model.id,
        content: [],
        usage: options.usage ?? zeroUsage(),
        stopReason: options.stopReason ?? "error",
        errorMessage: options.errorMessage,
        timestamp: options.now(),
        ...(options.responseId !== undefined ? { responseId: options.responseId } : {}),
    };
}

function stopReasonFromClaudeSdkResult(
    result: SDKResultMessage,
): Extract<StopReason, "stop" | "length"> {
    return result.stop_reason === "max_tokens" || result.terminal_reason === "max_turns"
        ? "length"
        : "stop";
}

function usageFromClaudeSdkResult(result: SDKResultMessage): Usage {
    const input = result.usage.input_tokens;
    const output = result.usage.output_tokens;
    const cacheRead = result.usage.cache_read_input_tokens;
    const cacheWrite = result.usage.cache_creation_input_tokens;

    return {
        input,
        output,
        cacheRead,
        cacheWrite,
        totalTokens: input + output + cacheRead + cacheWrite,
        cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: result.total_cost_usd,
        },
    };
}

function responseModelFromResult(result: SDKResultMessage): string | undefined {
    const models = Object.keys(result.modelUsage);
    return models.length === 0 ? undefined : models[0];
}

function sdkResultErrorMessage(result: SDKResultMessage): string {
    if (result.subtype === "success") {
        return "";
    }

    return result.errors.length > 0 ? result.errors.join("\n") : result.subtype;
}

function zeroUsage(): Usage {
    return {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
        },
    };
}
