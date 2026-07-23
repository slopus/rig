import type { Executor } from "@/Executor.js";
import type { ExecutorEvent } from "@/ExecutorEvent.js";
import type {
    SessionEvent,
    SessionMessage,
    SessionReasoningEffort,
    SessionTool,
} from "@slopus/rig-providers";

import { createInferenceStream } from "@/createInferenceStream.js";
import { parseOpenAIToolArguments } from "@/parseOpenAIToolArguments.js";
import { getCodexCollaborationToolDefinition } from "@/tools/codex/getCodexCollaborationToolDefinition.js";
import type {
    AssistantContent,
    AssistantMessage,
    AssistantMessageEvent,
    Context,
    Model,
    InferenceStream,
    StreamOptions,
    Tool,
    ToolCall,
    Usage,
} from "@/types.js";

export function createExecutorInferenceStream(options: {
    context: Context;
    executor: Executor;
    model: Model;
    providerId: string;
    streamOptions?: StreamOptions;
}): InferenceStream {
    return createInferenceStream(() => streamExecutorInference(options));
}

async function* streamExecutorInference(options: {
    context: Context;
    executor: Executor;
    model: Model;
    providerId: string;
    streamOptions?: StreamOptions;
}): AsyncGenerator<AssistantMessageEvent, AssistantMessage> {
    let partial = emptyAssistantMessage(options.model, options.providerId);
    let terminal = false;
    let activeTextIndex: number | undefined;
    let activeThinkingIndex: number | undefined;
    const activeTools = new Map<string, number>();
    const responseItems: string[] = [];

    const snapshot = () => ({
        ...partial,
        content: partial.content.map((content) => ({ ...content })),
        ...(responseItems.length === 0 ? {} : { responseItems: [...responseItems] }),
    });
    yield { type: "start", partial: snapshot() };

    try {
        const effort = toReasoningEffort(options.streamOptions?.thinking);
        const events = committedSessionEvents(
            toSessionEvents(
                options.executor.run({
                    context: { messages: toSessionMessages(options.context.messages) },
                    tools: toRigProviderSessionTools(options.context.tools ?? [], {
                        lockCodexCollaboration:
                            options.executor.type === "codex" &&
                            options.model.id.startsWith("openai/"),
                    }),
                    ...(options.streamOptions?.signal === undefined
                        ? {}
                        : { abort: options.streamOptions.signal }),
                    ...(effort === undefined ? {} : { effort }),
                    selection: {
                        modelId: options.model.id,
                        providerId: options.providerId,
                    },
                    ...(options.streamOptions?.serviceTier === "fast"
                        ? { serviceTier: "priority" }
                        : {}),
                    contextInstructions: options.context.systemPrompt ?? "",
                    ...(options.context.systemPromptOverride === undefined
                        ? {}
                        : { systemPrompt: options.context.systemPromptOverride }),
                }),
            ),
        );

        for await (const event of events) {
            if (event.type === "text_delta") {
                if (activeTextIndex === undefined) {
                    activeTextIndex = partial.content.length;
                    partial.content = [...partial.content, { type: "text", text: "" }];
                    yield {
                        type: "text_start",
                        contentIndex: activeTextIndex,
                        partial: snapshot(),
                    };
                }
                const content = partial.content[activeTextIndex];
                if (content?.type !== "text") continue;
                partial.content = replaceContent(partial.content, activeTextIndex, {
                    ...content,
                    text: content.text + event.delta,
                });
                yield {
                    type: "text_delta",
                    contentIndex: activeTextIndex,
                    delta: event.delta,
                    partial: snapshot(),
                };
                continue;
            }
            if (event.type === "reasoning_delta") {
                if (activeThinkingIndex === undefined) {
                    activeThinkingIndex = partial.content.length;
                    partial.content = [...partial.content, { type: "thinking", thinking: "" }];
                    yield {
                        type: "thinking_start",
                        contentIndex: activeThinkingIndex,
                        partial: snapshot(),
                    };
                }
                const content = partial.content[activeThinkingIndex];
                if (content?.type !== "thinking") continue;
                partial.content = replaceContent(partial.content, activeThinkingIndex, {
                    ...content,
                    thinking: content.thinking + event.delta,
                });
                yield {
                    type: "thinking_delta",
                    contentIndex: activeThinkingIndex,
                    delta: event.delta,
                    partial: snapshot(),
                };
                continue;
            }
            if (event.type === "encrypted_reasoning") {
                if (activeThinkingIndex === undefined) {
                    activeThinkingIndex = partial.content.length;
                    partial.content = [
                        ...partial.content,
                        { type: "thinking", thinking: "", encrypted: event.content },
                    ];
                } else {
                    const content = partial.content[activeThinkingIndex];
                    if (content?.type === "thinking") {
                        partial.content = replaceContent(partial.content, activeThinkingIndex, {
                            ...content,
                            encrypted: event.content,
                        });
                    }
                }
                continue;
            }
            if (event.type === "response_items") {
                responseItems.splice(0, responseItems.length, ...event.items);
                continue;
            }
            if (event.type === "tool_call_start") {
                activeTextIndex = undefined;
                activeThinkingIndex = undefined;
                const contentIndex = partial.content.length;
                activeTools.set(event.callId, contentIndex);
                partial.content = [
                    ...partial.content,
                    {
                        type: "toolCall",
                        id: event.callId,
                        name: event.name,
                        ...(event.namespace === undefined ? {} : { namespace: event.namespace }),
                        arguments: {},
                        ...toolCallMetadata(event.vendor),
                    },
                ];
                yield { type: "toolcall_start", contentIndex, partial: snapshot() };
                continue;
            }
            if (event.type === "tool_call_delta") {
                const contentIndex = activeTools.get(event.callId);
                if (contentIndex === undefined) continue;
                yield {
                    type: "toolcall_delta",
                    contentIndex,
                    delta: event.delta,
                    partial: snapshot(),
                };
                continue;
            }
            if (event.type === "tool_call_end") {
                const contentIndex = activeTools.get(event.callId);
                const content =
                    contentIndex === undefined ? undefined : partial.content[contentIndex];
                if (contentIndex === undefined || content?.type !== "toolCall") continue;
                const toolCall: ToolCall = {
                    ...content,
                    arguments:
                        content.kind === "custom"
                            ? { input: event.arguments }
                            : parseOpenAIToolArguments(event.arguments),
                };
                partial.content = replaceContent(partial.content, contentIndex, toolCall);
                yield { type: "toolcall_end", contentIndex, toolCall, partial: snapshot() };
                continue;
            }
            if (event.type === "token_usage") {
                partial = { ...partial, usage: toUsage(event.usage) };
                continue;
            }
            if (event.type !== "done") continue;

            terminal = true;
            if (activeTextIndex !== undefined) {
                const content = partial.content[activeTextIndex];
                if (content?.type === "text") {
                    yield {
                        type: "text_end",
                        contentIndex: activeTextIndex,
                        content: content.text,
                        partial: snapshot(),
                    };
                }
            }
            if (activeThinkingIndex !== undefined) {
                const content = partial.content[activeThinkingIndex];
                if (content?.type === "thinking") {
                    yield {
                        type: "thinking_end",
                        contentIndex: activeThinkingIndex,
                        content: content.thinking,
                        partial: snapshot(),
                    };
                }
            }

            partial = {
                ...partial,
                ...(responseItems.length === 0 ? {} : { responseItems: [...responseItems] }),
                stopReason:
                    event.state === "cancelled"
                        ? "aborted"
                        : event.state === "error"
                          ? "error"
                          : event.state === "tool_call"
                            ? "toolUse"
                            : event.state === "length"
                              ? "length"
                              : "stop",
                ...(event.state === "error"
                    ? {
                          errorMessage: event.message,
                          providerError: { type: "unclassified" as const },
                      }
                    : {}),
            };
            if (partial.stopReason === "error" || partial.stopReason === "aborted") {
                yield { type: "error", reason: partial.stopReason, error: snapshot() };
            } else {
                yield { type: "done", reason: partial.stopReason, message: snapshot() };
            }
            return partial;
        }
    } catch (error) {
        partial = {
            ...partial,
            errorMessage: error instanceof Error ? error.message : String(error),
            providerError: { type: "unclassified" },
            stopReason: options.streamOptions?.signal?.aborted ? "aborted" : "error",
        };
        terminal = true;
        const reason = options.streamOptions?.signal?.aborted ? "aborted" : "error";
        yield { type: "error", reason, error: snapshot() };
    }

    if (!terminal) {
        partial = {
            ...partial,
            stopReason: options.streamOptions?.signal?.aborted ? "aborted" : "error",
            ...(options.streamOptions?.signal?.aborted
                ? {}
                : { errorMessage: "The provider session ended without a final result." }),
        };
        const reason = options.streamOptions?.signal?.aborted ? "aborted" : "error";
        yield { type: "error", reason, error: snapshot() };
    }
    return partial;
}

async function* toSessionEvents(events: AsyncIterable<ExecutorEvent>) {
    for await (const event of events) {
        if (event.type === "reset_required") throw new Error(event.message);
        yield event;
    }
}

async function* committedSessionEvents(
    events: AsyncIterable<SessionEvent>,
): AsyncGenerator<SessionEvent> {
    let pending: SessionEvent[] | undefined;
    for await (const event of events) {
        if (event.type === "block_start") {
            pending = [];
        } else if (event.type === "block_reset") {
            pending = undefined;
        } else if (event.type === "block_end") {
            for (const committed of pending ?? []) yield committed;
            pending = undefined;
        } else if (pending === undefined) {
            yield event;
        } else {
            pending.push(event);
        }
    }
}

function toSessionMessages(messages: Context["messages"]): SessionMessage[] {
    return messages.map((message): SessionMessage => {
        if (message.role === "user") {
            const input =
                typeof message.content === "string"
                    ? undefined
                    : message.content.map((content) =>
                          content.type === "text"
                              ? { type: "text" as const, text: content.text }
                              : {
                                    type: "image" as const,
                                    data: content.data,
                                    mimeType: content.mimeType,
                                },
                      );
            return {
                role: "user",
                content:
                    typeof message.content === "string"
                        ? message.content
                        : message.content
                              .filter((content) => content.type === "text")
                              .map((content) => content.text)
                              .join(""),
                ...(input === undefined ? {} : { input }),
            };
        }
        if (message.role === "toolResult") {
            const input = message.content.map((content) =>
                content.type === "text"
                    ? { type: "text" as const, text: content.text }
                    : {
                          type: "image" as const,
                          data: content.data,
                          mimeType: content.mimeType,
                      },
            );
            return {
                role: "tool",
                callId: message.toolCallId,
                content: message.content
                    .filter((content) => content.type === "text")
                    .map((content) => content.text)
                    .join(""),
                input,
                ...(message.vendor === undefined ? {} : { vendor: message.vendor }),
            };
        }
        const thinking = message.content.filter((content) => content.type === "thinking");
        const toolCalls = message.content
            .filter((content) => content.type === "toolCall")
            .map((content) => ({
                callId: content.id,
                name: content.name,
                ...(content.namespace === undefined ? {} : { namespace: content.namespace }),
                arguments:
                    content.kind === "custom" && typeof content.arguments.input === "string"
                        ? content.arguments.input
                        : JSON.stringify(content.arguments),
                ...(content.vendor === undefined ? {} : { vendor: content.vendor }),
            }));
        const encryptedReasoning = thinking.at(-1)?.encrypted;
        return {
            role: "assistant",
            content: message.content
                .filter((content) => content.type === "text")
                .map((content) => content.text)
                .join(""),
            ...(encryptedReasoning === undefined ? {} : { encryptedReasoning }),
            ...(toolCalls.length === 0 ? {} : { toolCalls }),
            ...(message.responseItems === undefined
                ? {}
                : { responseItems: message.responseItems }),
        };
    });
}

export function toRigProviderSessionTools(
    tools: readonly Tool[],
    options: { lockCodexCollaboration?: boolean } = {},
): SessionTool[] {
    return tools.flatMap((tool): SessionTool[] => {
        const namespace = "namespace" in tool ? tool.namespace : undefined;
        const locked =
            options.lockCodexCollaboration === true && namespace === "collaboration"
                ? getCodexCollaborationToolDefinition(tool.name)
                : undefined;
        if (
            options.lockCodexCollaboration === true &&
            namespace === "collaboration" &&
            locked === undefined
        ) {
            throw new Error(
                `'collaboration.${tool.name}' is not a locked Codex collaboration function.`,
            );
        }
        if (locked !== undefined) {
            return toRigProviderSessionTools(
                [
                    {
                        ...locked,
                        namespace: "collaboration",
                        namespaceDescription: "Tools for spawning and managing sub-agents.",
                    },
                ],
                { lockCodexCollaboration: false },
            );
        }
        if (tool.kind === "custom") {
            return [
                {
                    name: tool.name,
                    type: "local",
                    description: tool.description,
                    ...(tool.namespace === undefined ? {} : { namespace: tool.namespace }),
                    ...(tool.namespaceDescription === undefined
                        ? {}
                        : { namespaceDescription: tool.namespaceDescription }),
                    ...(tool.format?.type === "grammar" && tool.format.syntax === "lark"
                        ? { grammar: { type: "lark", grammar: tool.format.definition } }
                        : {}),
                },
            ];
        }
        if (tool.kind === "tool_search") {
            return [
                {
                    name: tool.name,
                    type: "local",
                    description: tool.description,
                    parameters: tool.parameters,
                    vendor: {
                        provider: "codex",
                        type: "tool_search",
                        execution: "client",
                    },
                },
            ];
        }
        return [
            {
                name: tool.name,
                type: "local",
                description: tool.description,
                parameters: tool.parameters,
                ...(tool.namespace === undefined ? {} : { namespace: tool.namespace }),
                ...(tool.namespaceDescription === undefined
                    ? {}
                    : { namespaceDescription: tool.namespaceDescription }),
                ...(tool.deferLoading === undefined
                    ? {}
                    : {
                          vendor: {
                              provider: "codex",
                              type: "function",
                              deferLoading: tool.deferLoading,
                          },
                      }),
            },
        ];
    });
}

function toolCallMetadata(vendor: unknown): Pick<ToolCall, "kind" | "vendor"> {
    const type =
        typeof vendor === "object" && vendor !== null && "type" in vendor
            ? (vendor as { type?: unknown }).type
            : undefined;
    return {
        kind:
            type === "custom_tool_call"
                ? "custom"
                : type === "tool_search_call"
                  ? "tool_search"
                  : "function",
        ...(vendor === undefined ? {} : { vendor }),
    };
}

function replaceContent(
    content: readonly AssistantContent[],
    index: number,
    replacement: AssistantContent,
): readonly AssistantContent[] {
    return content.map((candidate, candidateIndex) =>
        candidateIndex === index ? replacement : candidate,
    );
}

function toReasoningEffort(value: string | undefined): SessionReasoningEffort | undefined {
    return value === "off" ||
        value === "minimal" ||
        value === "low" ||
        value === "medium" ||
        value === "high" ||
        value === "xhigh" ||
        value === "max"
        ? value
        : value === "ultra"
          ? "max"
          : undefined;
}

function emptyAssistantMessage(model: Model, providerId: string): AssistantMessage {
    return {
        role: "assistant",
        content: [],
        api: "rig-providers",
        provider: providerId,
        model: model.id,
        usage: toUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }),
        stopReason: "stop",
        timestamp: Date.now(),
    };
}

function toUsage(usage: Omit<Usage, "cost">): Usage {
    return {
        ...usage,
        cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
        },
    };
}
