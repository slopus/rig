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
    readonly provider: Provider;

    #client: ProtocolHttpClient;
    #modelId: string;
    #session: ProtocolSession;

    constructor(options: RemoteAgentOptions) {
        this.#client = options.client;
        this.#session = options.session;
        this.context = options.context;
        this.id = options.session.agentId;
        this.#modelId = options.session.modelId;
        this.provider = defineProvider({
            id: options.session.providerId,
            models: options.session.models,
            stream() {
                throw new Error("RemoteAgent does not expose provider streaming locally.");
            },
        });
    }

    get model(): Model {
        const model = this.provider.models.find((candidate) => candidate.id === this.#modelId);
        if (model === undefined) {
            throw new Error(`Unknown remote model '${this.#modelId}'.`);
        }
        return model;
    }

    reset(): void {
        this.#session = {
            ...this.#session,
            status: "idle",
            snapshot: {
                ...this.#session.snapshot,
                messages: [],
                queue: [],
                status: "idle",
            },
        };
        void this.#client.reset(this.#session.id).then((response) => {
            this.#session = response.session;
            this.#modelId = response.session.modelId;
        });
    }

    async send(text: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
        const submitted = await this.#client.submitMessage(this.#session.id, { text });
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

                if (event.type === "agent_event") {
                    await options.onEvent?.(event.data.event);
                    return;
                }

                if (event.type === "agent_message") {
                    this.#session = {
                        ...this.#session,
                        snapshot: {
                            ...this.#session.snapshot,
                            messages: [...this.#session.snapshot.messages, event.data.message],
                        },
                    };
                    await options.onMessage?.(event.data.message);
                    return;
                }

                if (event.type === "run_error") {
                    this.#session = {
                        ...this.#session,
                        status: "error",
                    };
                    failure = new Error(event.data.errorMessage);
                    streamController.abort();
                    return;
                }

                if (event.type === "run_finished") {
                    this.#session = {
                        ...this.#session,
                        status: event.data.stopReason === "aborted" ? "aborted" : "completed",
                    };
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
        void this.#client.changeModel(this.#session.id, {
            ...(effort !== undefined ? { effort } : {}),
            modelId: this.#modelId,
        });
    }

    setModel(modelId: string, effort: string | undefined): void {
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
        void this.#client.changeModel(this.#session.id, {
            ...(effort !== undefined ? { effort } : {}),
            modelId,
        });
    }

    snapshot(): AgentSnapshot {
        return this.#session.snapshot;
    }
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
