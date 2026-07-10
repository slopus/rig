import { createId } from "@paralleldrive/cuid2";

import { assistantMessageToAgentMessage } from "../agent/assistantMessageToAgentMessage.js";
import type {
    AgentLoopEvent,
    AgentRunResult,
    AgentSnapshot,
    ContentBlock,
} from "../agent/index.js";
import type { Message, UserMessage } from "../agent/types.js";
import type { CodingAssistantRuntime } from "../app/CodingAssistantRuntime.js";
import {
    createCodingAssistantAgent,
    type CreateCodingAssistantAgentOptions,
} from "../app/createCodingAssistantAgent.js";
import type {
    ChangeEffortRequest,
    ChangeModelRequest,
    CreateSessionRequest,
    EventId,
    ModelCatalog,
    ProtocolSession,
    SessionEvent,
    SessionAgentMetadata,
    SessionInterruption,
    SessionStatus,
    SessionSummary,
    SubagentSummary,
    SessionTitleStatus,
    SubmitMessageRequest,
    SubmitMessageResponse,
} from "../protocol/index.js";
import type { Model, StopReason } from "../providers/types.js";
import { generateSessionTitle } from "./generateSessionTitle.js";
import { getProviderIdForModel } from "./getProviderIdForModel.js";
import { resolveInitialModelSelection } from "./resolveInitialModelSelection.js";
import { SessionEventLog } from "./SessionEventLog.js";
import type { AgentSessionManager } from "./AgentSessionManager.js";

export interface PersistedSessionMessage {
    isPartial: boolean;
    message: Message;
    position: number;
    runId?: string;
}

export interface PersistedQueuedRun {
    displayText: string;
    runId: string;
    text: string;
    userMessage: UserMessage;
}

export interface PersistedSessionState {
    activeRunId?: string;
    agent: SessionAgentMetadata;
    agentId: string;
    cwd: string;
    effort?: string;
    id: string;
    instructions?: string;
    interruption?: SessionInterruption;
    lastMessageAt?: number;
    messages: readonly PersistedSessionMessage[];
    modelId: string;
    models: readonly Model[];
    providerId: string;
    queuedRuns: readonly PersistedQueuedRun[];
    status: SessionStatus;
    title?: string;
    titleError?: string;
    titleStatus: SessionTitleStatus;
    tools: readonly string[];
}

export interface InMemorySessionPersistence {
    clearMessages(sessionId: string): void;
    deleteQueuedRun(sessionId: string, runId: string): void;
    insertQueuedRun(sessionId: string, run: PersistedQueuedRun): void;
    saveSession(state: PersistedSessionState): void;
    upsertMessage(sessionId: string, message: PersistedSessionMessage): void;
}

export interface InMemorySessionOptions {
    agentManager?: AgentSessionManager;
    createEventId: () => EventId;
    emitCreatedEvent?: boolean;
    events?: readonly SessionEvent[];
    now?: () => number;
    modelCatalog: ModelCatalog;
    metadata?: SessionAgentMetadata;
    onAppendEvent?: (event: SessionEvent) => void;
    persistence?: InMemorySessionPersistence;
    request: CreateSessionRequest;
    restore?: PersistedSessionState;
}

interface ActiveRun {
    controller: AbortController;
    runId: string;
}

interface PartialMessageState {
    fallbackId: string;
    position: number | undefined;
    runId: string;
}

export interface SessionRunCompletion {
    errorMessage?: string;
    status: "aborted" | "completed" | "error";
}

export class InMemorySession {
    readonly events: SessionEventLog;
    readonly id: string;

    #activePartial: PartialMessageState | undefined;
    #activeRun: ActiveRun | undefined;
    #agentManager: AgentSessionManager | undefined;
    #agentMetadata: SessionAgentMetadata;
    #agentId: string;
    #createEventId: () => EventId;
    #draining: Promise<void> | undefined;
    #effort: string | undefined;
    #instructions: string | undefined;
    #interruption: SessionInterruption | undefined;
    #lastMessageAt: number | undefined;
    #messages: PersistedSessionMessage[] = [];
    #modelCatalog: ModelCatalog;
    #modelId: string;
    #models: readonly Model[];
    #now: () => number;
    #partialPositions = new Set<number>();
    #persistence: InMemorySessionPersistence | undefined;
    #providerId: string;
    #queue: PersistedQueuedRun[] = [];
    #request: CreateSessionRequest;
    #restoredActiveRunId: string | undefined;
    #runtime: CodingAssistantRuntime | undefined;
    #status: SessionStatus = "idle";
    #title: string | undefined;
    #titleError: string | undefined;
    #titleStatus: SessionTitleStatus = "idle";
    #tools: readonly string[] = [];

    constructor(options: InMemorySessionOptions) {
        this.#agentManager = options.agentManager;
        this.#createEventId = options.createEventId;
        this.#now = options.now ?? Date.now;
        this.#modelCatalog = options.modelCatalog;
        this.#persistence = options.persistence;
        this.#request = { ...options.request };
        this.id = options.restore?.id ?? createId();
        this.#agentMetadata = options.restore?.agent ??
            options.metadata ?? {
                depth: 0,
                rootSessionId: this.id,
                type: "primary",
            };
        this.#agentId = options.restore?.agentId ?? createId();
        const requestedModelId =
            options.restore?.modelId ??
            options.request.modelId ??
            this.#modelCatalog.defaultModelId;
        const requestedProviderId =
            options.restore?.providerId ??
            options.request.providerId ??
            this.#modelCatalog.defaultProviderId;
        const selection = resolveInitialModelSelection(
            this.#modelCatalog,
            requestedModelId,
            requestedProviderId,
        );
        this.#modelId = selection.model.id;
        this.#providerId = selection.providerId;
        const requestedEffort = options.restore?.effort ?? options.request.effort;
        this.#effort =
            requestedEffort !== undefined &&
            selection.model.thinkingLevels.includes(requestedEffort)
                ? requestedEffort
                : selection.model.defaultThinkingLevel;
        this.#instructions = options.restore?.instructions ?? options.request.instructions;
        this.#models = this.#modelsForProvider(this.#providerId);
        this.#status = options.restore?.status ?? "idle";
        this.#lastMessageAt = options.restore?.lastMessageAt;
        this.#restoredActiveRunId = options.restore?.activeRunId;
        this.#title = options.restore?.title ?? this.#agentMetadata.description;
        this.#titleError = options.restore?.titleError;
        this.#titleStatus =
            options.restore?.titleStatus ??
            (this.#agentMetadata.description !== undefined ? "ready" : "idle");
        this.#tools = options.restore?.tools ?? [];
        this.#interruption = options.restore?.interruption;
        this.#queue = [...(options.restore?.queuedRuns ?? [])];
        this.#messages = [...(options.restore?.messages ?? [])].sort(
            (left, right) => left.position - right.position,
        );
        for (const message of this.#messages) {
            if (message.isPartial) {
                this.#partialPositions.add(message.position);
            }
        }
        const eventLogOptions: ConstructorParameters<typeof SessionEventLog>[0] = {};
        if (options.events !== undefined) eventLogOptions.events = options.events;
        if (options.onAppendEvent !== undefined) eventLogOptions.onAppend = options.onAppendEvent;
        this.events = new SessionEventLog(eventLogOptions);

        this.#ensureKnownModel(this.#modelId, this.#providerId);
        this.#saveSession();
        if (options.restore === undefined) {
            if (options.emitCreatedEvent !== false) {
                this.emitCreatedEvent();
            }
        }
    }

    abort(): { aborted: boolean; eventId?: EventId } {
        const runId = this.#activeRun?.runId;
        if (this.#activeRun === undefined && this.#queue.length === 0) {
            return { aborted: false };
        }

        const queuedRunIds = this.#queue.map((queued) => queued.runId);
        for (const queued of this.#queue) {
            this.#persistence?.deleteQueuedRun(this.id, queued.runId);
        }
        this.#queue = [];
        this.#activeRun?.controller.abort();
        this.#restoredActiveRunId = undefined;
        void this.#runtime?.processManager.killAll({ forceAfterMs: 500 });
        const event = this.#append("abort_requested", runId !== undefined ? { runId } : {});
        for (const queuedRunId of queuedRunIds) {
            this.#append("run_error", {
                errorMessage: "The queued run was stopped.",
                runId: queuedRunId,
            });
        }
        return { aborted: true, eventId: event.id };
    }

    agentMetadata(): SessionAgentMetadata {
        return { ...this.#agentMetadata };
    }

    changeModel(request: ChangeModelRequest): ProtocolSession {
        const providerId =
            (request.providerId !== undefined
                ? getProviderIdForModel(this.#modelCatalog, request.modelId, request.providerId)
                : getProviderIdForModel(this.#modelCatalog, request.modelId, this.#providerId)) ??
            (request.providerId === undefined
                ? getProviderIdForModel(this.#modelCatalog, request.modelId)
                : undefined);
        if (providerId === undefined) {
            const providerDescription =
                request.providerId !== undefined ? ` for provider '${request.providerId}'` : "";
            throw new Error(`Unknown model '${request.modelId}'${providerDescription}.`);
        }

        if (
            this.#modelLocked() &&
            (request.modelId !== this.#modelId || providerId !== this.#providerId)
        ) {
            throw new Error("Model cannot be changed after the first message in a session.");
        }

        const model = this.#ensureKnownModel(request.modelId, providerId);

        if (request.modelId === this.#modelId && providerId === this.#providerId) {
            return this.changeEffort(
                request.effort !== undefined ? { effort: request.effort } : {},
            );
        }

        if (this.#runtime !== undefined) {
            throw new Error("Model cannot be changed after the session runtime has started.");
        }

        this.#modelId = model.id;
        this.#providerId = providerId;
        this.#effort = request.effort ?? model.defaultThinkingLevel;
        this.#models = this.#modelsForProvider(providerId);
        this.#interruption = undefined;
        this.#append("model_changed", {
            ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
            modelId: this.#modelId,
            snapshot: this.#agentSnapshot(),
        });
        return this.snapshot();
    }

    changeEffort(request: ChangeEffortRequest): ProtocolSession {
        const model = this.#selectedModel();
        const effort = request.effort ?? model.defaultThinkingLevel;
        if (!model.thinkingLevels.includes(effort)) {
            throw new Error(`Model '${model.id}' does not support '${effort}' reasoning.`);
        }

        this.#effort = effort;
        this.#runtime?.agent.setEffort(effort);
        this.#interruption = undefined;
        this.#append("effort_changed", {
            effort,
            modelId: this.#modelId,
            snapshot: this.#agentSnapshot(),
        });
        return this.snapshot();
    }

    emitCreatedEvent(): void {
        this.#append("session_created", { session: this.snapshot() });
    }

    markInterrupted(interruption: SessionInterruption): void {
        this.#interruption = interruption;
        this.#status = "error";
        this.#activeRun?.controller.abort();
        void this.#runtime?.processManager.killAll({ forceAfterMs: 500 });
        this.#activeRun = undefined;
        this.#restoredActiveRunId = undefined;
        this.#activePartial = undefined;
        const interruptedRunIds = [
            ...(interruption.runId !== undefined ? [interruption.runId] : []),
            ...this.#queue.map((queued) => queued.runId),
        ];
        for (const queued of this.#queue) {
            this.#persistence?.deleteQueuedRun(this.id, queued.runId);
        }
        this.#queue = [];
        if (interruptedRunIds.length > 0) {
            for (const runId of new Set(interruptedRunIds)) {
                this.#append("run_error", {
                    errorMessage: interruption.message,
                    runId,
                });
            }
            this.#saveSession();
            return;
        }

        this.#saveSession();
    }

    reset(): ProtocolSession {
        this.abort();
        this.#ensureRuntime().agent.reset();
        this.#status = "idle";
        this.#interruption = undefined;
        this.#restoredActiveRunId = undefined;
        this.#messages = [];
        this.#partialPositions.clear();
        this.#activePartial = undefined;
        this.#persistence?.clearMessages(this.id);
        this.#append("session_reset", { snapshot: this.#agentSnapshot() });
        return this.snapshot();
    }

    isSubagent(): boolean {
        return this.#agentMetadata.type === "subagent";
    }

    recordSubagentChanged(subagent: SubagentSummary): void {
        this.#append("subagent_changed", { subagent });
    }

    requestForSubagent(): CreateSessionRequest {
        return {
            cwd: this.#request.cwd,
            ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
            ...(this.#instructions !== undefined ? { instructions: this.#instructions } : {}),
            modelId: this.#modelId,
            ...(this.#request.apiKey !== undefined ? { apiKey: this.#request.apiKey } : {}),
        };
    }

    snapshot(): ProtocolSession {
        const snapshot = this.#agentSnapshot();
        const lastEventId = this.events.lastEventId();
        return {
            id: this.id,
            agentId: this.#agentId,
            cwd: this.#request.cwd,
            providerId: this.#providerId,
            modelId: this.#modelId,
            modelLocked: this.#modelLocked(),
            models: this.#models,
            status: this.#status,
            snapshot,
            titleStatus: this.#titleStatus,
            agent: this.agentMetadata(),
            ...(snapshot.effort !== undefined ? { effort: snapshot.effort } : {}),
            ...(this.#title !== undefined ? { title: this.#title } : {}),
            ...(this.#titleError !== undefined ? { titleError: this.#titleError } : {}),
            ...(this.#interruption !== undefined ? { interruption: this.#interruption } : {}),
            ...(lastEventId !== undefined ? { lastEventId } : {}),
        };
    }

    summary(): SessionSummary {
        return {
            id: this.id,
            cwd: this.#request.cwd,
            providerId: this.#providerId,
            modelId: this.#modelId,
            ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
            status: this.#status,
            titleStatus: this.#titleStatus,
            createdAt: this.events.firstCreatedAt() ?? this.#now(),
            updatedAt: this.events.lastCreatedAt() ?? this.#now(),
            ...(this.#lastMessageAt !== undefined ? { lastMessageAt: this.#lastMessageAt } : {}),
            ...(this.#title !== undefined ? { title: this.#title } : {}),
            ...(this.#titleError !== undefined ? { titleError: this.#titleError } : {}),
            ...(this.#interruption !== undefined ? { interruption: this.#interruption } : {}),
        };
    }

    state(): PersistedSessionState {
        const activeRunId = this.#activeRun?.runId ?? this.#restoredActiveRunId;
        const state: PersistedSessionState = {
            agent: this.agentMetadata(),
            agentId: this.#agentId,
            cwd: this.#request.cwd,
            ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
            id: this.id,
            ...(this.#instructions !== undefined ? { instructions: this.#instructions } : {}),
            ...(this.#interruption !== undefined ? { interruption: this.#interruption } : {}),
            ...(this.#lastMessageAt !== undefined ? { lastMessageAt: this.#lastMessageAt } : {}),
            messages: [...this.#messages],
            modelId: this.#modelId,
            models: this.#models,
            providerId: this.#providerId,
            queuedRuns: [...this.#queue],
            status: this.#status,
            ...(this.#title !== undefined ? { title: this.#title } : {}),
            ...(this.#titleError !== undefined ? { titleError: this.#titleError } : {}),
            titleStatus: this.#titleStatus,
            tools: this.#tools,
        };
        if (activeRunId !== undefined) {
            state.activeRunId = activeRunId;
        }
        return state;
    }

    submit(request: SubmitMessageRequest): SubmitMessageResponse {
        const runId = createId();
        const displayText = request.displayText ?? request.text;
        const blocks: readonly ContentBlock[] = request.content ?? [
            { type: "text", text: request.text },
        ];
        const userMessage: UserMessage = {
            role: "user",
            id: createId(),
            blocks,
        };
        const queued: PersistedQueuedRun = {
            displayText,
            runId,
            text: request.text,
            userMessage,
        };

        this.#interruption = undefined;
        this.#queue.push(queued);
        this.#persistence?.insertQueuedRun(this.id, queued);
        this.#status = this.#activeRun === undefined ? "queued" : "running";
        this.#lastMessageAt = this.#now();
        this.#storeMessage(this.#messages.length, userMessage, false, runId);
        const event = this.#append("message_submitted", {
            displayText,
            message: userMessage,
            runId,
        });
        this.#startTitleGeneration(request.text);
        this.#startDrainQueue();
        return {
            eventId: event.id,
            runId,
            sessionId: this.id,
        };
    }

    subagentSummary(): SubagentSummary {
        if (
            this.#agentMetadata.type !== "subagent" ||
            this.#agentMetadata.parentSessionId === undefined
        ) {
            throw new Error("Only subagent sessions have subagent summaries.");
        }

        return {
            agentId: this.#agentId,
            createdAt: this.events.firstCreatedAt() ?? this.#now(),
            depth: this.#agentMetadata.depth,
            description: this.#agentMetadata.description ?? "Delegated task",
            id: this.id,
            modelId: this.#modelId,
            parentSessionId: this.#agentMetadata.parentSessionId,
            ...(this.#agentMetadata.parentToolCallId !== undefined
                ? { parentToolCallId: this.#agentMetadata.parentToolCallId }
                : {}),
            status: this.#status,
            updatedAt: this.events.lastCreatedAt() ?? this.#now(),
        };
    }

    waitForRun(runId: string): Promise<SessionRunCompletion> {
        const completed = this.#completionForRun(runId);
        if (completed !== undefined) {
            return Promise.resolve(completed);
        }

        return new Promise((resolve) => {
            const unsubscribe = this.events.subscribe((event) => {
                if (
                    (event.type !== "run_finished" && event.type !== "run_error") ||
                    event.data.runId !== runId
                ) {
                    return;
                }
                unsubscribe();
                resolve(
                    event.type === "run_error"
                        ? { errorMessage: event.data.errorMessage, status: "error" }
                        : {
                              status: event.data.stopReason === "aborted" ? "aborted" : "completed",
                          },
                );
            });
        });
    }

    #agentSnapshot(): AgentSnapshot {
        const runtimeSnapshot = this.#runtime?.agent.snapshot();
        return {
            id: this.#agentId,
            providerId: this.#providerId,
            modelId: this.#modelId,
            status: this.#agentStatus(),
            messages: this.#committedMessages(),
            queue: runtimeSnapshot?.queue ?? [],
            tools: this.#tools,
            ...(this.#effort !== undefined ? { effort: this.#effort } : {}),
            ...(this.#instructions !== undefined ? { instructions: this.#instructions } : {}),
            ...(runtimeSnapshot?.lastRunId !== undefined
                ? { lastRunId: runtimeSnapshot.lastRunId }
                : {}),
        };
    }

    #agentStatus(): AgentSnapshot["status"] {
        if (this.#status === "running") {
            return "running";
        }
        if (this.#status === "aborted") {
            return "aborted";
        }
        return "idle";
    }

    #append<TType extends SessionEvent["type"]>(
        type: TType,
        data: Extract<SessionEvent, { type: TType }>["data"],
    ): Extract<SessionEvent, { type: TType }> {
        const event = {
            createdAt: this.#now(),
            data,
            id: this.#createEventId(),
            sessionId: this.id,
            type,
        } as Extract<SessionEvent, { type: TType }>;
        this.events.append(event);
        this.#saveSession();
        return event;
    }

    #appendAgentEvent(runId: string, event: AgentLoopEvent): void {
        if (this.#activeRun?.runId !== runId) {
            return;
        }

        if (event.type === "inference_iteration_start") {
            this.#activePartial = {
                fallbackId: `${runId}:assistant:${event.iteration}`,
                position: undefined,
                runId,
            };
        } else if ("partial" in event) {
            this.#storePartialMessage(runId, event.partial);
        }

        this.#append("agent_event", { event, runId });
    }

    #appendAgentMessage(runId: string, message: Message): void {
        if (this.#activeRun?.runId !== runId) {
            return;
        }

        const position =
            message.role === "agent" && this.#activePartial?.runId === runId
                ? this.#activePartial.position
                : undefined;
        this.#storeMessage(position ?? this.#messages.length, message, false, runId);
        if (position !== undefined) {
            this.#activePartial = undefined;
        }
        this.#append("agent_message", { message, runId });
    }

    #appendRunFinished(runId: string, result: AgentRunResult): void {
        const stopReason: StopReason = result.stopReason;
        this.#status = stopReason === "aborted" ? "aborted" : "completed";
        this.#activePartial = undefined;
        if (this.#activeRun?.runId === runId) {
            this.#activeRun = undefined;
        }
        this.#append("run_finished", {
            agentRunId: result.runId,
            runId,
            stopReason,
        });
    }

    #committedMessages(): Message[] {
        return this.#messages
            .filter((message) => !message.isPartial)
            .sort((left, right) => left.position - right.position)
            .map((message) => message.message);
    }

    #ensureKnownModel(modelId: string, providerId: string): Model {
        const model = this.#modelsForProvider(providerId).find(
            (candidate) => candidate.id === modelId,
        );
        if (model === undefined) {
            throw new Error(`Unknown model '${modelId}' for provider '${providerId}'.`);
        }
        return model;
    }

    #ensureRuntime(): CodingAssistantRuntime {
        if (this.#runtime !== undefined) {
            return this.#runtime;
        }

        const options: CreateCodingAssistantAgentOptions = {
            agentId: this.#agentId,
            cwd: this.#request.cwd,
            messages: this.#committedMessages(),
            modelId: this.#modelId,
            providerId: this.#providerId,
        };
        if (this.#effort !== undefined) options.effort = this.#effort;
        if (this.#instructions !== undefined) options.instructions = this.#instructions;
        if (this.#request.apiKey !== undefined) options.apiKey = this.#request.apiKey;
        if (this.#agentManager !== undefined) {
            options.subagents = {
                canSpawn: this.#agentMetadata.depth < this.#agentManager.maxDepth,
                depth: this.#agentMetadata.depth,
                maxDepth: this.#agentManager.maxDepth,
                spawn: (request, signal) =>
                    this.#agentManager?.spawn(this.id, request, signal) ??
                    Promise.reject(new Error("Subagent management is unavailable.")),
            };
        }
        const runtime = createCodingAssistantAgent(options);
        const snapshot = runtime.agent.snapshot();
        this.#runtime = runtime;
        this.#agentId = snapshot.id;
        this.#providerId = runtime.provider.id;
        this.#modelId = snapshot.modelId;
        this.#effort = snapshot.effort;
        this.#instructions = snapshot.instructions;
        this.#models = this.#modelsForProvider(this.#providerId);
        this.#tools = snapshot.tools;
        this.#saveSession();
        return runtime;
    }

    async #drainQueue(): Promise<void> {
        for (;;) {
            const queued = this.#queue.shift();
            if (queued === undefined) {
                if (this.#status === "queued" || this.#status === "running") {
                    this.#status = "idle";
                }
                this.#saveSession();
                return;
            }

            this.#persistence?.deleteQueuedRun(this.id, queued.runId);
            await this.#runQueued(queued);
        }
    }

    #saveSession(): void {
        this.#persistence?.saveSession(this.state());
    }

    #completionForRun(runId: string): SessionRunCompletion | undefined {
        const events = this.events.since(undefined) ?? [];
        for (let index = events.length - 1; index >= 0; index -= 1) {
            const event = events[index];
            if (
                event === undefined ||
                (event.type !== "run_finished" && event.type !== "run_error") ||
                event.data.runId !== runId
            ) {
                continue;
            }
            if (event.type === "run_error") {
                return { errorMessage: event.data.errorMessage, status: "error" };
            }
            return {
                status: event.data.stopReason === "aborted" ? "aborted" : "completed",
            };
        }
        return undefined;
    }

    #modelLocked(): boolean {
        return this.#messages.some((message) => !message.isPartial);
    }

    #selectedModel(): Model {
        const model = this.#models.find((candidate) => candidate.id === this.#modelId);
        if (model === undefined) {
            throw new Error(`Unknown model '${this.#modelId}' for provider '${this.#providerId}'.`);
        }
        return model;
    }

    #modelsForProvider(providerId: string): readonly Model[] {
        return (
            this.#modelCatalog.providers.find((provider) => provider.providerId === providerId)
                ?.models ?? []
        );
    }

    #startTitleGeneration(firstMessage: string): void {
        if (
            this.#title !== undefined ||
            this.#titleStatus === "generating" ||
            this.#titleStatus === "ready"
        ) {
            return;
        }

        this.#titleStatus = "generating";
        this.#titleError = undefined;
        this.#append("session_title_changed", { status: this.#titleStatus });
        void this.#generateTitle(firstMessage);
    }

    async #generateTitle(firstMessage: string): Promise<void> {
        try {
            const title = await generateSessionTitle({
                firstMessage,
                now: this.#now,
                provider: this.#ensureRuntime().provider,
                sessionId: this.id,
            });
            this.#title = title;
            this.#titleStatus = "ready";
            this.#titleError = undefined;
            this.#append("session_title_changed", { status: this.#titleStatus, title });
        } catch (error) {
            this.#titleStatus = "error";
            this.#titleError = error instanceof Error ? error.message : String(error);
            this.#append("session_title_changed", {
                errorMessage: this.#titleError,
                status: this.#titleStatus,
            });
        }
    }

    async #runQueued(queued: PersistedQueuedRun): Promise<void> {
        const controller = new AbortController();
        this.#activeRun = { controller, runId: queued.runId };
        this.#restoredActiveRunId = undefined;
        this.#status = "running";
        this.#append("run_started", { runId: queued.runId });

        try {
            const runtime = this.#ensureRuntime();
            runtime.agent.enqueueMessage(queued.userMessage);
            const result = await runtime.agent.run({
                signal: controller.signal,
                onEvent: (event) => this.#appendAgentEvent(queued.runId, event),
                onMessage: (message) => this.#appendAgentMessage(queued.runId, message),
            });
            if (this.#activeRun?.runId !== queued.runId) {
                return;
            }
            this.#appendRunFinished(queued.runId, result);
        } catch (error) {
            if (this.#activeRun?.runId !== queued.runId) {
                return;
            }
            this.#status = "error";
            this.#activePartial = undefined;
            if (this.#activeRun?.runId === queued.runId) {
                this.#activeRun = undefined;
            }
            this.#append("run_error", {
                errorMessage: error instanceof Error ? error.message : String(error),
                runId: queued.runId,
            });
        } finally {
            if (this.#activeRun?.runId === queued.runId) {
                this.#activeRun = undefined;
            }
            this.#saveSession();
        }
    }

    #startDrainQueue(): void {
        if (this.#draining !== undefined) {
            return;
        }

        this.#draining = this.#drainQueue().finally(() => {
            this.#draining = undefined;
        });
    }

    #storeMessage(position: number, message: Message, isPartial: boolean, runId: string): void {
        const entry: PersistedSessionMessage = {
            isPartial,
            message,
            position,
            runId,
        };
        this.#messages = [
            ...this.#messages.filter((candidate) => candidate.position !== position),
            entry,
        ].sort((left, right) => left.position - right.position);
        if (isPartial) {
            this.#partialPositions.add(position);
        } else {
            this.#partialPositions.delete(position);
        }
        this.#persistence?.upsertMessage(this.id, entry);
    }

    #storePartialMessage(
        runId: string,
        partial: Parameters<typeof assistantMessageToAgentMessage>[0],
    ): void {
        const activePartial =
            this.#activePartial?.runId === runId
                ? this.#activePartial
                : {
                      fallbackId: `${runId}:assistant`,
                      position: undefined,
                      runId,
                  };
        const position = activePartial.position ?? this.#messages.length;
        this.#activePartial = {
            ...activePartial,
            position,
        };
        const message = assistantMessageToAgentMessage(partial, () => activePartial.fallbackId);
        this.#storeMessage(position, message, true, runId);
    }
}
