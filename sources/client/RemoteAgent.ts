import type {
    AgentContext,
    AgentCompactionResult,
    AgentRunOptions,
    AgentRunResult,
    AgentSnapshot,
    ContentBlock,
} from "../agent/index.js";
import type {
    CodingAssistantAgentBackend,
    CodingAssistantModelChoice,
} from "../app/CodingAssistantAgentBackend.js";
import type { ModelCatalog, ProtocolSession, SessionEvent } from "../protocol/index.js";
import { defineProvider, type Model, type Provider, type StopReason } from "../providers/types.js";
import type { PermissionMode } from "../permissions/index.js";
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

    constructor(options: RemoteAgentOptions) {
        this.#client = options.client;
        this.#session = options.session;
        this.#modelCatalog = options.modelCatalog;
        this.context = options.context;
        this.id = options.session.agentId;
        this.#modelId = options.session.modelId;
        this.#models = options.session.models;
        this.#providerId = options.session.providerId;
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

    get provider(): Provider {
        return defineProvider({
            id: this.#providerId,
            models: this.#models,
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

    async send(
        content: string | readonly ContentBlock[],
        options: AgentRunOptions = {},
    ): Promise<AgentRunResult> {
        const displayText = options.displayText ?? contentToDisplayText(content);
        const submitted = await this.#client.submitMessage(this.#session.id, {
            ...(typeof content === "string" ? {} : { content }),
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

    setModel(modelId: string, effort: string | undefined, providerId?: string): void {
        const nextProviderId = providerId ?? this.#providerId;
        if (
            !this.canChangeModel &&
            (modelId !== this.#modelId || nextProviderId !== this.#providerId)
        ) {
            this.setEffort(effort);
            return;
        }

        const nextModels =
            this.#modelCatalog?.providers.find((provider) => provider.providerId === nextProviderId)
                ?.models ?? this.#models;
        if (!nextModels.some((model) => model.id === modelId)) {
            throw new Error(`Unknown remote model '${modelId}' for provider '${nextProviderId}'.`);
        }

        this.#modelId = modelId;
        this.#models = nextModels;
        this.#providerId = nextProviderId;
        this.#session = {
            ...this.#session,
            ...(effort !== undefined ? { effort } : {}),
            modelId,
            models: nextModels,
            providerId: nextProviderId,
            snapshot: {
                ...this.#session.snapshot,
                ...(effort !== undefined ? { effort } : {}),
                modelId,
                providerId: nextProviderId,
            },
        };
        void this.#client
            .changeModel(this.#session.id, {
                ...(effort !== undefined ? { effort } : {}),
                modelId,
                providerId: nextProviderId,
            })
            .then((response) => {
                this.#replaceSession(response.session);
            });
    }

    setPermissionMode(permissionMode: PermissionMode): void {
        this.#session = { ...this.#session, permissionMode };
        this.context.permissions?.setMode(permissionMode);
        void this.#client
            .changePermissionMode(this.#session.id, { permissionMode })
            .then((response) => this.#replaceSession(response.session));
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
            this.#session = { ...this.#session, status: "running" };
            return;
        }

        if (event.type === "run_error") {
            this.#session = { ...this.#session, status: "error" };
            return;
        }

        if (event.type === "run_finished") {
            this.#session = {
                ...this.#session,
                status: event.data.stopReason === "aborted" ? "aborted" : "completed",
            };
            return;
        }

        if (event.type === "session_reset") {
            this.#session = {
                ...this.#session,
                modelLocked: false,
                snapshot: event.data.snapshot,
                status: "idle",
            };
            return;
        }

        if (event.type === "model_changed" || event.type === "effort_changed") {
            this.#modelId = event.data.modelId;
            this.#providerId = event.data.snapshot.providerId;
            this.#session = {
                ...this.#session,
                ...(event.data.effort !== undefined ? { effort: event.data.effort } : {}),
                modelId: event.data.modelId,
                providerId: event.data.snapshot.providerId,
                snapshot: event.data.snapshot,
            };
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
        this.#session = session;
        this.context.permissions?.setMode(session.permissionMode);
        this.#modelId = session.modelId;
        this.#models = session.models;
        this.#providerId = session.providerId;
    }
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
