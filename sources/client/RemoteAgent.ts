import type {
    AgentContext,
    AgentRunOptions,
    AgentRunResult,
    AgentSnapshot,
} from "../agent/index.js";
import type { CodingAssistantAgentBackend } from "../app/CodingAssistantAgentBackend.js";
import type { ProtocolSession, SessionEvent } from "../protocol/index.js";
import { defineProvider, type Model, type Provider, type StopReason } from "../providers/types.js";
import { ProtocolHttpClient } from "./ProtocolHttpClient.js";

export interface RemoteAgentOptions {
    client: ProtocolHttpClient;
    context: AgentContext;
    session: ProtocolSession;
}

export class RemoteAgent implements CodingAssistantAgentBackend {
    readonly context: AgentContext;
    readonly id: string;

    #client: ProtocolHttpClient;
    #modelId: string;
    #models: readonly Model[];
    #providerId: string;
    #session: ProtocolSession;

    constructor(options: RemoteAgentOptions) {
        this.#client = options.client;
        this.#session = options.session;
        this.context = options.context;
        this.id = options.session.agentId;
        this.#modelId = options.session.modelId;
        this.#models = options.session.models;
        this.#providerId = options.session.providerId;
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

    async send(text: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
        const submitted = await this.#client.submitMessage(this.#session.id, {
            ...(options.displayText !== undefined ? { displayText: options.displayText } : {}),
            text,
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
                runId: submitted.runId,
                stopReason: aborted ? "aborted" : "error",
            };
        }

        return {
            messages: finished.messages,
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

    setModel(modelId: string, effort: string | undefined): void {
        if (!this.canChangeModel && modelId !== this.#modelId) {
            this.setEffort(effort);
            return;
        }

        this.#modelId = modelId;
        this.#session = {
            ...this.#session,
            ...(effort !== undefined ? { effort } : {}),
            modelId,
            snapshot: {
                ...this.#session.snapshot,
                ...(effort !== undefined ? { effort } : {}),
                modelId,
            },
        };
        void this.#client
            .changeModel(this.#session.id, {
                ...(effort !== undefined ? { effort } : {}),
                modelId,
            })
            .then((response) => {
                this.#replaceSession(response.session);
            });
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
            this.#providerId = providerIdFromModelId(event.data.modelId, this.#providerId);
            this.#session = {
                ...this.#session,
                ...(event.data.effort !== undefined ? { effort: event.data.effort } : {}),
                modelId: event.data.modelId,
                snapshot: event.data.snapshot,
            };
        }
    }

    #replaceSession(session: ProtocolSession): void {
        this.#session = session;
        this.#modelId = session.modelId;
        this.#models = session.models;
        this.#providerId = session.providerId;
    }
}

function providerIdFromModelId(modelId: string, fallback: string): string {
    if (modelId.startsWith("anthropic/")) {
        return "claude-sdk";
    }
    if (modelId.startsWith("openai/")) {
        return "codex";
    }
    return fallback;
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
