import type {
    AgentContext,
    AgentCompactionResult,
    AgentRunOptions,
    AgentRunResult,
    AgentSnapshot,
    ContentBlock,
    UserMessage,
} from "../agent/index.js";
import type {
    CodingAssistantAgentBackend,
    CodingAssistantModelChoice,
} from "../app/CodingAssistantAgentBackend.js";
import type { ModelCatalog, ProtocolSession, SessionEvent } from "../protocol/index.js";
import {
    defineProvider,
    type Model,
    type Provider,
    type ServiceTier,
    type StopReason,
} from "../providers/types.js";
import type { PermissionMode } from "../permissions/index.js";
import type { GoalStatus, SessionGoal } from "../goals/index.js";
import { ProtocolHttpClient } from "./ProtocolHttpClient.js";

export interface RemoteAgentOptions {
    client: ProtocolHttpClient;
    context: AgentContext;
    modelCatalog?: ModelCatalog;
    session: ProtocolSession;
}

export class RemoteAgent implements CodingAssistantAgentBackend {
    readonly context: AgentContext;
    readonly id: string;

    #client: ProtocolHttpClient;
    #modelId: string;
    #modelCatalog: ModelCatalog | undefined;
    #models: readonly Model[];
    #providerId: string;
    #session: ProtocolSession;
    #configurationChangeQueue: Promise<void> = Promise.resolve();
    #modelChangeVersion = 0;
    #confirmedEffort: string | undefined;
    #confirmedModelId: string;
    #confirmedModels: readonly Model[];
    #confirmedProviderId: string;
    #confirmedServiceTier: ServiceTier | undefined;
    #serviceTierChangeCount = 0;
    #serviceTierIntent: ServiceTier | undefined;
    #serviceTierIntentVersion = 0;

    constructor(options: RemoteAgentOptions) {
        this.#client = options.client;
        this.#session = options.session;
        this.#modelCatalog = options.modelCatalog;
        this.context = options.context;
        this.id = options.session.agentId;
        this.#modelId = options.session.modelId;
        this.#models = options.session.models;
        this.#providerId = options.session.providerId;
        this.#confirmedEffort = options.session.effort ?? options.session.snapshot.effort;
        this.#confirmedModelId = options.session.modelId;
        this.#confirmedModels = options.session.models;
        this.#confirmedProviderId = options.session.providerId;
        this.#confirmedServiceTier = sessionServiceTier(options.session);
        this.#serviceTierIntent = this.#confirmedServiceTier;
    }

    async steer(
        content: string | readonly ContentBlock[],
        options: AgentRunOptions = {},
    ): Promise<void> {
        const displayText = options.displayText ?? contentToDisplayText(content);
        await this.#client.steerMessage(this.#session.id, {
            ...(typeof content === "string" ? {} : { content }),
            ...(options.displayText !== undefined ? { displayText: options.displayText } : {}),
            text: displayText,
        });
    }

    get canChangeModel(): boolean {
        return !this.#session.modelLocked;
    }

    get confirmedServiceTier(): ServiceTier | undefined {
        return this.#confirmedServiceTier;
    }

    get provider(): Provider {
        const serviceTiers = this.#modelCatalog?.providers.find(
            (provider) => provider.providerId === this.#providerId,
        )?.serviceTiers;
        return defineProvider({
            id: this.#providerId,
            models: this.#models,
            ...(serviceTiers === undefined ? {} : { serviceTiers }),
            stream() {
                throw new Error("RemoteAgent does not expose provider streaming locally.");
            },
        });
    }

    get model(): Model {
        const model = this.#models.find((candidate) => candidate.id === this.#modelId);
        if (model === undefined) {
            throw new Error(`Unknown remote model '${this.#modelId}'.`);
        }
        return model;
    }

    get modelChoices(): readonly CodingAssistantModelChoice[] {
        return (
            this.#modelCatalog?.providers.flatMap((provider) =>
                provider.models.map((model) => ({ model, providerId: provider.providerId })),
            ) ?? this.#models.map((model) => ({ model, providerId: this.#providerId }))
        );
    }

    get permissionMode(): PermissionMode {
        return this.#session.permissionMode;
    }

    get goal(): SessionGoal | undefined {
        return this.#session.goal === undefined ? undefined : { ...this.#session.goal };
    }

    abort() {
        return this.#client.abort(this.#session.id);
    }

    async setGoal(objective: string): Promise<void> {
        const response = await this.#client.setGoal(this.#session.id, { objective });
        this.#replaceSession(response.session);
    }

    async changeGoalStatus(status: GoalStatus): Promise<void> {
        const response = await this.#client.changeGoalStatus(this.#session.id, { status });
        this.#replaceSession(response.session);
    }

    async clearGoal(): Promise<void> {
        const response = await this.#client.clearGoal(this.#session.id);
        this.#replaceSession(response.session);
    }

    async compact(): Promise<AgentCompactionResult> {
        const response = await this.#client.compact(this.#session.id);
        this.#replaceSession(response.session);
        return response.result;
    }

    reset(): void {
        this.#session = {
            ...this.#session,
            modelLocked: false,
            status: "idle",
            snapshot: {
                ...this.#session.snapshot,
                messages: [],
                queue: [],
                status: "idle",
            },
        };
        void this.#client.reset(this.#session.id).then((response) => {
            this.#replaceSession(response.session);
        });
    }

    async rewind(messageId: string): Promise<UserMessage> {
        const response = await this.#client.rewind(this.#session.id, messageId);
        this.#replaceSession(response.session);
        return response.message;
    }

    async send(
        content: string | readonly ContentBlock[],
        options: AgentRunOptions = {},
    ): Promise<AgentRunResult> {
        const displayText = options.displayText ?? contentToDisplayText(content);
        const requestContent =
            typeof content === "string"
                ? options.displayText !== undefined && content !== displayText
                    ? [{ type: "text" as const, text: content }]
                    : undefined
                : content;
        const submitted = await this.#client.submitMessage(this.#session.id, {
            ...(requestContent === undefined ? {} : { content: requestContent }),
            ...(options.displayText !== undefined ? { displayText: options.displayText } : {}),
            text: displayText,
        });
        const streamController = new AbortController();
        let finished:
            | {
                  agentRunId?: string;
                  messages: AgentSnapshot["messages"];
                  stopReason: StopReason;
              }
            | undefined;
        let failure: Error | undefined;
        let aborted = false;

        const abort = () => {
            aborted = true;
            void this.#client.abort(this.#session.id);
        };
        options.signal?.addEventListener("abort", abort, { once: true });

        await this.#client.watchSessionEvents({
            after: submitted.eventId,
            sessionId: this.#session.id,
            signal: streamController.signal,
            onEvent: async (event) => {
                if (!isRunEvent(event, submitted.runId)) {
                    return;
                }

                this.applySessionEvent(event);

                if (event.type === "run_error") {
                    failure = new Error(event.data.errorMessage);
                    streamController.abort();
                    return;
                }

                if (event.type === "run_finished") {
                    finished = {
                        ...(event.data.agentRunId !== undefined
                            ? { agentRunId: event.data.agentRunId }
                            : {}),
                        messages: this.#session.snapshot.messages,
                        stopReason: event.data.stopReason,
                    };
                    streamController.abort();
                }
            },
        });

        options.signal?.removeEventListener("abort", abort);

        if (failure !== undefined) {
            throw failure;
        }
        if (finished === undefined) {
            return {
                messages: this.#session.snapshot.messages,
                contextMessages:
                    this.#session.snapshot.contextMessages ?? this.#session.snapshot.messages,
                runId: submitted.runId,
                stopReason: aborted ? "aborted" : "error",
            };
        }

        return {
            messages: finished.messages,
            contextMessages:
                this.#session.snapshot.contextMessages ?? this.#session.snapshot.messages,
            runId: finished.agentRunId ?? submitted.runId,
            stopReason: finished.stopReason,
        };
    }

    setEffort(effort: string | undefined): void {
        this.#session = {
            ...this.#session,
            ...(effort !== undefined ? { effort } : {}),
            snapshot: {
                ...this.#session.snapshot,
                ...(effort !== undefined ? { effort } : {}),
            },
        };
        const request = effort !== undefined ? { effort } : {};
        void this.#client.changeEffort(this.#session.id, request).then((response) => {
            this.#replaceSession(response.session);
        });
    }

    setModel(
        modelId: string,
        effort: string | undefined,
        providerId?: string,
    ): void | Promise<void> {
        const nextProviderId = providerId ?? this.#providerId;
        if (
            !this.canChangeModel &&
            (modelId !== this.#modelId || nextProviderId !== this.#providerId)
        ) {
            this.setEffort(effort);
            return;
        }

        const nextProvider = this.#modelCatalog?.providers.find(
            (provider) => provider.providerId === nextProviderId,
        );
        const nextModels = nextProvider?.models ?? this.#models;
        if (!nextModels.some((model) => model.id === modelId)) {
            throw new Error(`Unknown remote model '${modelId}' for provider '${nextProviderId}'.`);
        }

        const version = ++this.#modelChangeVersion;
        this.#modelId = modelId;
        this.#models = nextModels;
        this.#providerId = nextProviderId;
        const currentServiceTier = this.#session.serviceTier ?? this.#session.snapshot.serviceTier;
        const keepServiceTier =
            currentServiceTier === undefined ||
            nextProvider?.serviceTiers?.includes(currentServiceTier) === true;
        const { serviceTier: _sessionServiceTier, ...sessionWithoutServiceTier } = this.#session;
        const { serviceTier: _snapshotServiceTier, ...snapshotWithoutServiceTier } =
            this.#session.snapshot;
        this.#session = {
            ...(keepServiceTier ? this.#session : sessionWithoutServiceTier),
            ...(effort !== undefined ? { effort } : {}),
            modelId,
            models: nextModels,
            providerId: nextProviderId,
            snapshot: {
                ...(keepServiceTier ? this.#session.snapshot : snapshotWithoutServiceTier),
                ...(effort !== undefined ? { effort } : {}),
                modelId,
                providerId: nextProviderId,
            },
        };
        const operation = this.#enqueueConfigurationChange(async () => {
            try {
                const response = await this.#client.changeModel(this.#session.id, {
                    ...(effort !== undefined ? { effort } : {}),
                    modelId,
                    providerId: nextProviderId,
                });
                this.#recordConfirmedSession(response.session);
                if (version === this.#modelChangeVersion) {
                    this.#replaceSession(response.session);
                }
            } catch (error) {
                if (version === this.#modelChangeVersion) {
                    this.#restoreConfirmedModelSelection();
                }
                throw error;
            }
        });
        return operation;
    }

    setServiceTier(serviceTier: ServiceTier | undefined): Promise<void> {
        const version = ++this.#serviceTierIntentVersion;
        this.#serviceTierIntent = serviceTier;
        this.#serviceTierChangeCount += 1;
        this.#setLocalServiceTier(serviceTier);
        const request = serviceTier === undefined ? {} : { serviceTier };
        return this.#enqueueConfigurationChange(async () => {
            try {
                const response = await this.#client.changeServiceTier(this.#session.id, request);
                this.#confirmedServiceTier = sessionServiceTier(response.session);
                if (version === this.#serviceTierIntentVersion) {
                    this.#replaceSession(response.session);
                }
            } catch (error) {
                if (version === this.#serviceTierIntentVersion) {
                    this.#setLocalServiceTier(this.#confirmedServiceTier);
                }
                throw error;
            } finally {
                this.#serviceTierChangeCount -= 1;
                if (this.#serviceTierChangeCount === 0) {
                    this.#serviceTierIntent = this.#confirmedServiceTier;
                }
            }
        });
    }

    async setPermissionMode(permissionMode: PermissionMode): Promise<void> {
        const response = await this.#client.changePermissionMode(this.#session.id, {
            permissionMode,
        });
        this.#replaceSession(response.session);
    }

    snapshot(): AgentSnapshot {
        return this.#session.snapshot;
    }

    applySessionEvent(event: SessionEvent): void {
        if (event.sessionId !== this.#session.id) {
            return;
        }

        if (event.type === "session_created") {
            this.#replaceSession(event.data.session);
            return;
        }

        if (event.type === "message_submitted") {
            this.#session = {
                ...this.#session,
                modelLocked: true,
                status: this.#session.status === "running" ? "running" : "queued",
                snapshot: {
                    ...this.#session.snapshot,
                    messages: appendUniqueMessage(
                        this.#session.snapshot.messages,
                        event.data.message,
                    ),
                },
            };
            return;
        }

        if (event.type === "agent_message") {
            this.#session = {
                ...this.#session,
                snapshot: {
                    ...this.#session.snapshot,
                    messages: appendUniqueMessage(
                        this.#session.snapshot.messages,
                        event.data.message,
                    ),
                },
            };
            return;
        }

        if (event.type === "run_started") {
            this.#session = { ...this.#session, modelLocked: true, status: "running" };
            return;
        }

        if (event.type === "run_error") {
            this.#session = {
                ...this.#session,
                modelLocked: event.data.modelLocked,
                status: "error",
            };
            return;
        }

        if (event.type === "run_finished") {
            this.#session = {
                ...this.#session,
                modelLocked: event.data.modelLocked,
                status: event.data.stopReason === "aborted" ? "aborted" : "completed",
            };
            return;
        }

        if (event.type === "session_reset") {
            this.#session = {
                ...this.#session,
                modelLocked: false,
                status: "idle",
            };
            this.#applyAuthoritativeSnapshot(event.data.snapshot);
            return;
        }

        if (event.type === "session_rewound") {
            this.#session = {
                ...this.#session,
                modelLocked: false,
                status: "idle",
            };
            this.#applyAuthoritativeSnapshot(event.data.snapshot);
            return;
        }

        if (event.type === "model_changed" || event.type === "effort_changed") {
            this.#modelId = event.data.modelId;
            this.#providerId = event.data.snapshot.providerId;
            this.#models =
                this.#modelCatalog?.providers.find(
                    (provider) => provider.providerId === this.#providerId,
                )?.models ?? this.#models;
            this.#session = {
                ...this.#session,
                ...(event.data.effort !== undefined ? { effort: event.data.effort } : {}),
                modelLocked: event.type === "model_changed" ? false : this.#session.modelLocked,
                modelId: event.data.modelId,
                models: this.#models,
                providerId: event.data.snapshot.providerId,
            };
            this.#applyAuthoritativeSnapshot(event.data.snapshot);
            return;
        }

        if (event.type === "service_tier_changed") {
            const { serviceTier: _serviceTier, ...session } = this.#session;
            this.#session = {
                ...session,
                ...(event.data.serviceTier === null ? {} : { serviceTier: event.data.serviceTier }),
                snapshot: event.data.snapshot,
            };
            this.#confirmedServiceTier =
                event.data.serviceTier === null ? undefined : event.data.serviceTier;
            if (this.#serviceTierChangeCount > 0) {
                this.#setLocalServiceTier(this.#serviceTierIntent);
            }
            return;
        }

        if (event.type === "permission_mode_changed") {
            this.#session = {
                ...this.#session,
                permissionMode: event.data.permissionMode,
            };
            this.context.permissions?.setMode(event.data.permissionMode);
            return;
        }

        if (event.type === "goal_changed") {
            if (event.data.goal === null) {
                const { goal: _goal, ...session } = this.#session;
                this.#session = session;
            } else {
                this.#session = { ...this.#session, goal: { ...event.data.goal } };
            }
            return;
        }

        if (event.type === "user_input_requested") {
            this.#session = {
                ...this.#session,
                pendingUserInputs: [
                    ...this.#session.pendingUserInputs.filter(
                        (request) => request.requestId !== event.data.requestId,
                    ),
                    event.data,
                ],
            };
            return;
        }

        if (event.type === "user_input_resolved") {
            this.#session = {
                ...this.#session,
                pendingUserInputs: this.#session.pendingUserInputs.filter(
                    (request) => request.requestId !== event.data.requestId,
                ),
            };
            return;
        }

        if (event.type === "mcp_servers_changed") {
            this.#session = { ...this.#session, mcpServers: event.data.servers };
            return;
        }

        if (event.type === "tasks_changed") {
            this.#session = { ...this.#session, tasks: event.data.tasks };
            return;
        }
    }

    #replaceSession(session: ProtocolSession): void {
        this.#recordConfirmedSession(session);
        this.#session = session;
        if (this.#serviceTierChangeCount > 0) {
            this.#setLocalServiceTier(this.#serviceTierIntent);
        }
        this.context.permissions?.setMode(session.permissionMode);
        this.#modelId = session.modelId;
        this.#models = session.models;
        this.#providerId = session.providerId;
    }

    #enqueueConfigurationChange(change: () => Promise<void>): Promise<void> {
        const operation = this.#configurationChangeQueue.then(change);
        this.#configurationChangeQueue = operation.catch(() => undefined);
        return operation;
    }

    #applyAuthoritativeSnapshot(snapshot: AgentSnapshot): void {
        const { serviceTier: _serviceTier, ...session } = this.#session;
        this.#session = {
            ...session,
            ...(snapshot.serviceTier === undefined ? {} : { serviceTier: snapshot.serviceTier }),
            snapshot,
        };
        this.#recordConfirmedSession(this.#session);
        if (this.#serviceTierChangeCount > 0) {
            this.#setLocalServiceTier(this.#serviceTierIntent);
        }
    }

    #recordConfirmedSession(session: ProtocolSession): void {
        this.#confirmedEffort = session.effort ?? session.snapshot.effort;
        this.#confirmedModelId = session.modelId;
        this.#confirmedModels = session.models;
        this.#confirmedProviderId = session.providerId;
        this.#confirmedServiceTier = sessionServiceTier(session);
    }

    #restoreConfirmedModelSelection(): void {
        this.#modelId = this.#confirmedModelId;
        this.#models = this.#confirmedModels;
        this.#providerId = this.#confirmedProviderId;
        const { effort: _sessionEffort, ...session } = this.#session;
        const { effort: _snapshotEffort, ...snapshot } = this.#session.snapshot;
        this.#session = {
            ...session,
            ...(this.#confirmedEffort === undefined ? {} : { effort: this.#confirmedEffort }),
            modelId: this.#confirmedModelId,
            models: this.#confirmedModels,
            providerId: this.#confirmedProviderId,
            snapshot: {
                ...snapshot,
                ...(this.#confirmedEffort === undefined ? {} : { effort: this.#confirmedEffort }),
                modelId: this.#confirmedModelId,
                providerId: this.#confirmedProviderId,
            },
        };
        this.#setLocalServiceTier(
            this.#serviceTierChangeCount > 0 ? this.#serviceTierIntent : this.#confirmedServiceTier,
        );
    }

    #setLocalServiceTier(serviceTier: ServiceTier | undefined): void {
        const { serviceTier: _sessionServiceTier, ...session } = this.#session;
        const { serviceTier: _snapshotServiceTier, ...snapshot } = this.#session.snapshot;
        this.#session = {
            ...session,
            ...(serviceTier === undefined ? {} : { serviceTier }),
            snapshot: {
                ...snapshot,
                ...(serviceTier === undefined ? {} : { serviceTier }),
            },
        };
    }
}

function sessionServiceTier(session: ProtocolSession): ServiceTier | undefined {
    return session.serviceTier ?? session.snapshot.serviceTier;
}

function appendUniqueMessage(
    messages: AgentSnapshot["messages"],
    message: AgentSnapshot["messages"][number],
): AgentSnapshot["messages"] {
    if (messages.some((candidate) => candidate.id === message.id)) {
        return messages;
    }
    return [...messages, message];
}

function isRunEvent(event: SessionEvent, runId: string): boolean {
    if (
        event.type !== "agent_event" &&
        event.type !== "agent_message" &&
        event.type !== "run_error" &&
        event.type !== "run_finished" &&
        event.type !== "run_started"
    ) {
        return false;
    }

    return event.data.runId === runId;
}

function contentToDisplayText(content: string | readonly ContentBlock[]): string {
    if (typeof content === "string") {
        return content;
    }

    return content
        .map((block) => (block.type === "text" ? block.text : `[image:${block.mediaType}]`))
        .join("");
}
