import { createId } from "@paralleldrive/cuid2";

import type { AgentContext } from "./context/AgentContext.js";
import { runAgentLoop, type AgentLoopEvent, type AgentLoopResult } from "./loop.js";
import { printAgentMessageToConsole, type AgentConsole } from "./printAgentMessageToConsole.js";
import { selectToolsForModel } from "./selectToolsForModel.js";
import type { AnyDefinedTool, ContentBlock, Message, SystemMessage, UserMessage } from "./types.js";
import type { Model, Provider } from "../providers/types.js";

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
    status: AgentStatus;
    instructions?: string;
    messages: readonly Message[];
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
    messages?: readonly Message[];
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
    displayText?: string;
    signal?: AbortSignal;
    onEvent?: (event: AgentLoopEvent) => void | Promise<void>;
    onMessage?: (message: Message) => void | Promise<void>;
}

export interface AgentRunResult extends AgentLoopResult {
    runId: string;
}

export class Agent {
    readonly id: string;
    readonly provider: Provider;
    readonly context: AgentContext;

    #model: Model;
    #effort: string | undefined;
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
    #queue: QueuedAgentMessage[] = [];
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

    get canChangeModel(): boolean {
        return (
            this.#messages.length === 0 &&
            this.#queue.length === 0 &&
            this.#activeRunId === undefined
        );
    }

    setInstructions(instructions: string | undefined): void {
        this.#instructions = instructions;
    }

    setEffort(effort: string | undefined): void {
        this.#effort = effort;
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

    setTools(tools: readonly AnyDefinedTool[]): void {
        this.#tools = tools;
    }

    reset(): void {
        this.#messages = [];
        this.#queue = [];
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

        try {
            const loopOptions: Parameters<typeof runAgentLoop>[0] = {
                provider: this.provider,
                modelId: this.#model.id,
                tools: this.#tools,
                messages: this.#messages,
                sessionId: runId,
                idFactory: this.#idFactory,
                now: this.#now,
                context: this.context,
                onEvent: async (event) => this.#handleEvent(event, options),
                onMessage: async (message) => this.#handleMessage(message, options),
            };
            if (this.#effort !== undefined) loopOptions.effort = this.#effort;
            if (this.#instructions !== undefined) loopOptions.instructions = this.#instructions;
            if (options.signal !== undefined) loopOptions.signal = options.signal;

            const result = await runAgentLoop(loopOptions);

            if (this.#activeRunId === runId) {
                this.#activeRunId = undefined;
            }
            if (this.#resetVersion === resetVersion) {
                this.#messages = [...result.messages];
                this.#status = result.stopReason === "aborted" ? "aborted" : "idle";
            } else if (this.#status === "running") {
                this.#status = "idle";
            }
            return {
                ...result,
                runId,
            };
        } catch (error) {
            if (this.#activeRunId === runId) {
                this.#activeRunId = undefined;
            }
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

    #drainQueueToTranscript(): void {
        if (this.#queue.length === 0) {
            return;
        }

        const queued = this.#queue;
        this.#queue = [];
        for (const entry of queued) {
            this.#messages.push(entry.message);
            this.#printMessage(entry.message);
        }
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
