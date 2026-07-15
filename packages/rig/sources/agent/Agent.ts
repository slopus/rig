import { createId } from "@paralleldrive/cuid2";

import {
    compactConversation,
    type CompactConversationResult,
} from "./compaction/compactConversation.js";
import type { AgentContext } from "./context/AgentContext.js";
import { runAgentLoop, type AgentLoopEvent, type AgentLoopResult } from "./loop.js";
import { createDebugProvider, type DebugLog } from "../debug/index.js";
import { printAgentMessageToConsole, type AgentConsole } from "./printAgentMessageToConsole.js";
import { selectToolsForModel } from "./selectToolsForModel.js";
import type { AnyDefinedTool, ContentBlock, Message, SystemMessage, UserMessage } from "./types.js";
import type { Model, Provider, ServiceTier } from "../providers/types.js";
import type { PermissionMode } from "../permissions/index.js";

export type AgentStatus = "idle" | "running" | "aborted";

export interface QueuedAgentMessage {
    id: string;
    message: Message;
}

export interface AgentSnapshot {
    id: string;
    providerId: string;
    modelId: string;
    effort?: string;
    serviceTier?: ServiceTier;
    status: AgentStatus;
    instructions?: string;
    messages: readonly Message[];
    /** Compacted model-facing history. Omitted while it matches the visible transcript. */
    contextMessages?: readonly Message[];
    queue: readonly QueuedAgentMessage[];
    tools: readonly string[];
    lastRunId?: string;
}

export interface AgentOptions {
    provider: Provider;
    modelId: string;
    context: AgentContext;
    id?: string;
    effort?: string;
    serviceTier?: ServiceTier;
    messages?: readonly Message[];
    contextMessages?: readonly Message[];
    instructions?: string;
    tools?: readonly AnyDefinedTool[];
    idFactory?: () => string;
    now?: () => number;
    console?: AgentConsole;
    printToConsole?: boolean;
    onEvent?: (event: AgentLoopEvent) => void | Promise<void>;
    onMessage?: (message: Message) => void | Promise<void>;
}

export interface AgentRunOptions {
    debug?: DebugLog;
    displayText?: string;
    signal?: AbortSignal;
    onEvent?: (event: AgentLoopEvent) => void | Promise<void>;
    onMessage?: (message: Message) => void | Promise<void>;
}

export interface AgentRunResult extends AgentLoopResult {
    debugDirectory?: string;
    runId: string;
}

export interface AgentCompactionResult {
    compacted: boolean;
    compactedMessageCount: number;
    estimatedTokensAfter: number;
    estimatedTokensBefore: number;
    retainedMessageCount: number;
}

export class Agent {
    readonly id: string;
    readonly provider: Provider;
    readonly context: AgentContext;

    #model: Model;
    #effort: string | undefined;
    #serviceTier: ServiceTier | undefined;
    #instructions: string | undefined;
    #tools: readonly AnyDefinedTool[];
    #usesExplicitTools: boolean;
    #idFactory: () => string;
    #now: () => number;
    #console: AgentConsole;
    #printToConsole: boolean;
    #onEvent: ((event: AgentLoopEvent) => void | Promise<void>) | undefined;
    #onMessage: ((message: Message) => void | Promise<void>) | undefined;
    #messages: Message[] = [];
    #contextMessages: Message[] | undefined;
    #queue: QueuedAgentMessage[] = [];
    #steeringQueue: UserMessage[] = [];
    #status: AgentStatus = "idle";
    #lastRunId: string | undefined;
    #activeRunId: string | undefined;
    #resetVersion = 0;

    constructor(options: AgentOptions) {
        this.#idFactory = options.idFactory ?? createId;
        this.id = options.id ?? this.#idFactory();
        this.provider = options.provider;
        this.#model = this.#findModel(options.modelId);
        this.context = options.context;
        this.#effort = options.effort ?? this.#model.defaultThinkingLevel;
        this.#serviceTier = this.#validateServiceTier(options.serviceTier);
        this.#instructions = options.instructions;
        this.#usesExplicitTools = options.tools !== undefined;
        this.#tools =
            options.tools ??
            selectToolsForModel({
                provider: options.provider,
                model: this.#model,
            });
        this.#now = options.now ?? Date.now;
        this.#console = options.console ?? console;
        this.#printToConsole = options.printToConsole ?? true;
        this.#onEvent = options.onEvent;
        this.#onMessage = options.onMessage;
        this.#messages = [...(options.messages ?? [])];
        this.#contextMessages =
            options.contextMessages === undefined ? undefined : [...options.contextMessages];
    }

    get status(): AgentStatus {
        return this.#status;
    }

    get model(): Model {
        return this.#model;
    }

    get messages(): readonly Message[] {
        return this.#messages;
    }

    get queue(): readonly QueuedAgentMessage[] {
        return this.#queue;
    }

    get tools(): readonly AnyDefinedTool[] {
        return this.#tools;
    }

    get permissionMode(): PermissionMode {
        return this.context.permissions?.mode ?? "full_access";
    }

    get canChangeModel(): boolean {
        return (
            this.#messages.length === 0 &&
            this.#queue.length === 0 &&
            this.#activeRunId === undefined
        );
    }

    get confirmedServiceTier(): ServiceTier | undefined {
        return this.#serviceTier;
    }

    setInstructions(instructions: string | undefined): void {
        this.#instructions = instructions;
    }

    setEffort(effort: string | undefined): void {
        this.#effort = effort;
    }

    setServiceTier(serviceTier: ServiceTier | undefined): void {
        this.#serviceTier = this.#validateServiceTier(serviceTier);
    }

    setModel(modelId: string, effort: string | undefined): void {
        const model = this.#findModel(modelId);
        this.#model = model;
        this.#effort = effort ?? model.defaultThinkingLevel;
        if (!this.#usesExplicitTools) {
            this.#tools = selectToolsForModel({
                provider: this.provider,
                model,
            });
        }
    }

    #takeSteering(): readonly UserMessage[] {
        const steering = this.#steeringQueue;
        this.#steeringQueue = [];
        for (const message of steering) this.#printMessage(message);
        return steering;
    }

    setTools(tools: readonly AnyDefinedTool[]): void {
        this.#tools = tools;
    }

    setPermissionMode(mode: PermissionMode): void {
        this.context.permissions?.setMode(mode);
    }

    reset(): void {
        this.#messages = [];
        this.#contextMessages = undefined;
        this.#queue = [];
        this.#steeringQueue = [];
        this.#lastRunId = undefined;
        this.#resetVersion += 1;
        if (this.#activeRunId === undefined) {
            this.#status = "idle";
        }
    }

    addSteering(text: string): SystemMessage {
        return this.enqueueSystemMessage(text);
    }

    enqueueSystemMessage(text: string): SystemMessage {
        const message: SystemMessage = {
            role: "system",
            id: this.#idFactory(),
            blocks: [{ type: "text", text }],
        };
        this.enqueueMessage(message);
        return message;
    }

    enqueueUserMessage(text: string | readonly ContentBlock[]): UserMessage {
        const message: UserMessage = {
            role: "user",
            id: this.#idFactory(),
            blocks: typeof text === "string" ? [{ type: "text", text }] : text,
        };
        this.enqueueMessage(message);
        return message;
    }

    enqueueMessage(message: Message): QueuedAgentMessage {
        const queued = {
            id: this.#idFactory(),
            message,
        };
        this.#queue.push(queued);
        return queued;
    }

    async send(
        text: string | readonly ContentBlock[],
        options: AgentRunOptions = {},
    ): Promise<AgentRunResult> {
        if (this.#activeRunId !== undefined) {
            throw new Error(`Agent '${this.id}' is already running`);
        }

        this.enqueueUserMessage(text);
        return this.run(options);
    }

    async steer(content: string | readonly ContentBlock[]): Promise<void> {
        this.steerMessage({
            role: "user",
            id: this.#idFactory(),
            blocks: typeof content === "string" ? [{ type: "text", text: content }] : content,
        });
    }

    steerMessage(message: UserMessage): void {
        if (this.#activeRunId === undefined) {
            throw new Error(`Agent '${this.id}' is not running`);
        }
        this.#steeringQueue.push(message);
    }

    async compact(signal?: AbortSignal): Promise<AgentCompactionResult> {
        if (this.#activeRunId !== undefined) {
            throw new Error("Wait for the active response to finish before compacting.");
        }

        const runId = this.#idFactory();
        this.#activeRunId = runId;
        this.#status = "running";
        try {
            const result = await this.#compactContext({
                force: true,
                preserveLatestUserMessage: false,
                ...(signal !== undefined ? { signal } : {}),
            });
            this.#status = "idle";
            return result;
        } finally {
            if (this.#activeRunId === runId) this.#activeRunId = undefined;
            if (this.#status === "running") this.#status = signal?.aborted ? "aborted" : "idle";
        }
    }

    async run(options: AgentRunOptions = {}): Promise<AgentRunResult> {
        if (this.#activeRunId !== undefined) {
            throw new Error(`Agent '${this.id}' is already running`);
        }

        const runId = this.#idFactory();
        const resetVersion = this.#resetVersion;
        this.#lastRunId = runId;
        this.#activeRunId = runId;
        this.#status = "running";
        this.#drainQueueToTranscript();
        const provider =
            options.debug === undefined
                ? this.provider
                : createDebugProvider(this.provider, {
                      log: options.debug,
                      runId,
                      source: "agent",
                  });

        try {
            try {
                const compaction = await this.#compactContext({
                    force: false,
                    preserveLatestUserMessage: true,
                    provider,
                    ...(options.signal !== undefined ? { signal: options.signal } : {}),
                });
                if (compaction.compacted) {
                    await this.#handleEvent(
                        {
                            type: "context_compacted",
                            compactedMessageCount: compaction.compactedMessageCount,
                            estimatedTokensAfter: compaction.estimatedTokensAfter,
                            estimatedTokensBefore: compaction.estimatedTokensBefore,
                            reason: "threshold",
                        },
                        options,
                    );
                }
            } catch (error) {
                // The main loop still gets a chance to report an abort or the provider's
                // context-limit error when automatic compaction is unavailable.
                if (!options.signal?.aborted) {
                    this.#console.error?.(`[agent:${this.id}] automatic compaction failed`, error);
                }
            }

            let contextCompactedDuringRun = false;
            const loopOptions: Parameters<typeof runAgentLoop>[0] = {
                provider,
                modelId: this.#model.id,
                tools: this.#tools,
                messages: this.#messages,
                sessionId: runId,
                idFactory: this.#idFactory,
                now: this.#now,
                context: this.context,
                onEvent: async (event) => this.#handleEvent(event, options),
                onMessage: async (message) => this.#handleMessage(message, options),
                takeSteering: () => this.#takeSteering(),
                compactContext: async (messages, compaction) => {
                    try {
                        const result = await this.#compactMessages({
                            messages,
                            force: compaction.force,
                            preserveLatestUserMessage: true,
                            provider,
                            ...(compaction.reportedTokens === undefined
                                ? {}
                                : { reportedTokens: compaction.reportedTokens }),
                            ...(options.signal === undefined ? {} : { signal: options.signal }),
                        });
                        contextCompactedDuringRun ||= result.compacted;
                        if (result.compacted) {
                            await this.#handleEvent(
                                {
                                    type: "context_compacted",
                                    compactedMessageCount: result.compactedMessageCount,
                                    estimatedTokensAfter: result.estimatedTokensAfter,
                                    estimatedTokensBefore: result.estimatedTokensBefore,
                                    reason: compaction.force ? "context_window" : "threshold",
                                },
                                options,
                            );
                        }
                        return result;
                    } catch (error) {
                        if (!options.signal?.aborted) {
                            this.#console.error?.(
                                `[agent:${this.id}] automatic compaction failed`,
                                error,
                            );
                        }
                        return undefined;
                    }
                },
            };
            if (this.#contextMessages !== undefined) {
                loopOptions.contextMessages = this.#contextMessages;
            }
            if (this.#effort !== undefined) loopOptions.effort = this.#effort;
            if (this.#serviceTier !== undefined) loopOptions.serviceTier = this.#serviceTier;
            if (this.#instructions !== undefined) loopOptions.instructions = this.#instructions;
            if (options.signal !== undefined) loopOptions.signal = options.signal;
            if (options.debug !== undefined) loopOptions.debug = options.debug;

            const result = await runAgentLoop(loopOptions);

            if (this.#activeRunId === runId) {
                this.#activeRunId = undefined;
            }
            this.#steeringQueue = [];
            if (this.#resetVersion === resetVersion) {
                this.#messages = [...result.messages];
                if (this.#contextMessages !== undefined || contextCompactedDuringRun) {
                    this.#contextMessages = [...result.contextMessages];
                }
                this.#status = result.stopReason === "aborted" ? "aborted" : "idle";
            } else if (this.#status === "running") {
                this.#status = "idle";
            }
            return {
                ...result,
                ...(options.debug === undefined ? {} : { debugDirectory: options.debug.directory }),
                runId,
            };
        } catch (error) {
            if (this.#activeRunId === runId) {
                this.#activeRunId = undefined;
            }
            this.#steeringQueue = [];
            if (this.#resetVersion === resetVersion) {
                this.#status = options.signal?.aborted ? "aborted" : "idle";
            } else if (this.#status === "running") {
                this.#status = "idle";
            }
            throw error;
        }
    }

    snapshot(): AgentSnapshot {
        return {
            id: this.id,
            providerId: this.provider.id,
            modelId: this.#model.id,
            status: this.#status,
            messages: [...this.#messages],
            queue: [...this.#queue],
            tools: this.#tools.map((tool) => tool.name),
            ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
            ...(this.#serviceTier !== undefined ? { serviceTier: this.#serviceTier } : {}),
            ...(this.#contextMessages !== undefined
                ? { contextMessages: [...this.#contextMessages] }
                : {}),
            ...(this.#instructions !== undefined ? { instructions: this.#instructions } : {}),
            ...(this.#lastRunId !== undefined ? { lastRunId: this.#lastRunId } : {}),
        };
    }

    #findModel(modelId: string): Model {
        const model = this.provider.models.find((candidate) => candidate.id === modelId);
        if (!model) {
            throw new Error(`Unknown model '${modelId}' for provider '${this.provider.id}'`);
        }
        return model;
    }

    #validateServiceTier(serviceTier: ServiceTier | undefined): ServiceTier | undefined {
        if (serviceTier === undefined) return undefined;
        if (this.provider.serviceTiers?.includes(serviceTier) === true) return serviceTier;
        throw new Error(`Provider '${this.provider.id}' does not support fast inference.`);
    }

    #drainQueueToTranscript(): void {
        if (this.#queue.length === 0) {
            return;
        }

        const queued = this.#queue;
        this.#queue = [];
        for (const entry of queued) {
            this.#messages.push(entry.message);
            this.#contextMessages?.push(entry.message);
            this.#printMessage(entry.message);
        }
    }

    async #compactContext(options: {
        force: boolean;
        preserveLatestUserMessage: boolean;
        provider?: Provider;
        signal?: AbortSignal;
    }): Promise<AgentCompactionResult> {
        const result = await this.#compactMessages({
            messages: this.#contextMessages ?? this.#messages,
            force: options.force,
            preserveLatestUserMessage: options.preserveLatestUserMessage,
            ...(options.provider === undefined ? {} : { provider: options.provider }),
            ...(options.signal !== undefined ? { signal: options.signal } : {}),
        });
        if (result.compacted) {
            this.#contextMessages = [...result.contextMessages];
        }
        return {
            compacted: result.compacted,
            compactedMessageCount: result.compactedMessageCount,
            estimatedTokensAfter: result.estimatedTokensAfter,
            estimatedTokensBefore: result.estimatedTokensBefore,
            retainedMessageCount: result.retainedMessageCount,
        };
    }

    async #compactMessages(options: {
        messages: readonly Message[];
        force: boolean;
        preserveLatestUserMessage: boolean;
        provider?: Provider;
        reportedTokens?: number;
        signal?: AbortSignal;
    }): Promise<CompactConversationResult> {
        return compactConversation({
            provider: options.provider ?? this.provider,
            model: this.#model,
            messages: options.messages,
            idFactory: this.#idFactory,
            now: this.#now,
            force: options.force,
            preserveLatestUserMessage: options.preserveLatestUserMessage,
            ...(options.reportedTokens === undefined
                ? {}
                : { reportedTokens: options.reportedTokens }),
            ...(this.#effort !== undefined ? { thinking: this.#effort } : {}),
            ...(this.#serviceTier !== undefined ? { serviceTier: this.#serviceTier } : {}),
            ...(options.signal !== undefined ? { signal: options.signal } : {}),
        });
    }

    #printMessage(message: Message): void {
        if (!this.#printToConsole) {
            return;
        }

        printAgentMessageToConsole(message, this.#console);
    }

    #printEvent(event: AgentLoopEvent): void {
        if (!this.#printToConsole) {
            return;
        }

        if (event.type === "toolcall_end") {
            this.#console.log(
                `[agent:${this.id}] tool_call ${event.toolCall.name}:${event.toolCall.id}`,
            );
        }
    }

    async #handleMessage(message: Message, options: AgentRunOptions): Promise<void> {
        this.#printMessage(message);
        await this.#onMessage?.(message);
        await options.onMessage?.(message);
    }

    async #handleEvent(event: AgentLoopEvent, options: AgentRunOptions): Promise<void> {
        this.#printEvent(event);
        await this.#onEvent?.(event);
        await options.onEvent?.(event);
    }
}
