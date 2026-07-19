import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { Duplex } from "node:stream";

import {
    RemoteTerminalProtocolClient,
    type RemoteTerminalReconnectState,
} from "@slopus/ghostty-web";

import type {
    AbortRunOptions,
    AbortRunResponse,
    BroadcastMessageRequest,
    BroadcastMessageResponse,
    AnswerUserInputRequest,
    ChangeEffortRequest,
    ChangeModelRequest,
    ChangePermissionModeRequest,
    ChangeServiceTierRequest,
    ChangeSessionGoalStatusRequest,
    CompactSessionResponse,
    CreateSessionRequest,
    CreateSessionResponse,
    EventId,
    ForkSessionResponse,
    GetCurrentProviderQuotaResponse,
    GetDaemonConfigResponse,
    GetSessionUsageResponse,
    GlobalEventQueueEntry,
    HealthResponse,
    GoalSessionResponse,
    ListGlobalEventsResponse,
    ListExternalToolCallsResponse,
    ListModelsResponse,
    ListSecretsResponse,
    ListSessionsResponse,
    ListSubagentsResponse,
    ProtocolSession,
    RecordSessionActivityResponse,
    ResolveExternalToolCallRequest,
    ResolveExternalToolCallResponse,
    RewindSessionResponse,
    RegisterSecretRequest,
    RegisterSecretResponse,
    SearchFilesResponse,
    SecretSessionResponse,
    SessionEvent,
    ShutdownServerResponse,
    SetGoalRequest,
    SteerMessageRequest,
    SteerMessageResponse,
    StopWorkflowResponse,
    SubmitMessageRequest,
    SubmitMessageResponse,
    TrimGlobalEventsResponse,
    UnregisterSecretResponse,
    UpdateDaemonConfigRequest,
    UpdateDaemonConfigResponse,
    UpdateSessionRequest,
} from "../protocol/index.js";
import type { SecretAttachmentScope } from "../secrets/index.js";
import { parseGlobalSseEvent } from "./parseGlobalSseEvent.js";
import { EventStreamHttpError } from "./EventStreamHttpError.js";
import type {
    CreateRemoteTerminalRequest,
    CreateRemoteTerminalResponse,
    ListRemoteTerminalsResponse,
    RemoteTerminalResponse,
    ResizeRemoteTerminalRequest,
} from "../terminal/index.js";
import type { ExternalToolCall } from "../external-tools/index.js";
import { connectRemoteTerminalWebSocket } from "./connectRemoteTerminalWebSocket.js";
import { RemoteTerminalAttachment } from "./RemoteTerminalAttachment.js";
import { RemoteTerminalClientReplica } from "./RemoteTerminalClientReplica.js";

export interface ProtocolHttpClientOptions {
    socketPath: string;
    token: string;
}

export interface WatchSessionEventsOptions {
    after?: EventId;
    signal?: AbortSignal;
    sessionId: string;
    onEvent: (event: SessionEvent) => void | Promise<void>;
}

export interface WatchGlobalEventsOptions {
    after?: number;
    signal?: AbortSignal;
    onEvent: (entry: GlobalEventQueueEntry) => void | Promise<void>;
}

export interface AttachRemoteTerminalOptions {
    clientId?: string;
    creditBytes?: number;
    reconnectState?: RemoteTerminalReconnectState;
    replica?: RemoteTerminalClientReplica;
}

export class ProtocolHttpClient {
    readonly socketPath: string;
    readonly token: string;

    constructor(options: ProtocolHttpClientOptions) {
        this.socketPath = options.socketPath;
        this.token = options.token;
    }

    steerMessage(sessionId: string, request: SteerMessageRequest): Promise<SteerMessageResponse> {
        return this.#requestJson(
            "POST",
            `/sessions/${encodeURIComponent(sessionId)}/steer`,
            request,
        );
    }

    abort(sessionId: string, options: AbortRunOptions = {}): Promise<AbortRunResponse> {
        const parameters = new URLSearchParams();
        if (options.continuePendingSteering === true) {
            parameters.set("continuePendingSteering", "1");
        }
        if (options.expectedRunId !== undefined) {
            parameters.set("expectedRunId", options.expectedRunId);
        }
        for (const messageId of options.steeringMessageIds ?? []) {
            parameters.append("steeringMessageId", messageId);
        }
        const query = parameters.size > 0 ? `?${parameters.toString()}` : "";
        return this.#requestJson(
            "POST",
            `/sessions/${encodeURIComponent(sessionId)}/abort${query}`,
        );
    }

    stopBackgroundProcesses(sessionId: string): Promise<{ stoppedProcesses: number }> {
        return this.#requestJson(
            "POST",
            `/sessions/${encodeURIComponent(sessionId)}/background-processes/stop`,
        );
    }

    answerUserInput(
        sessionId: string,
        requestId: string,
        request: AnswerUserInputRequest,
    ): Promise<{ session: ProtocolSession }> {
        return this.#requestJson(
            "POST",
            `/sessions/${encodeURIComponent(sessionId)}/user-input/${encodeURIComponent(requestId)}`,
            request,
        );
    }

    changeModel(
        sessionId: string,
        request: ChangeModelRequest,
    ): Promise<{ session: ProtocolSession }> {
        return this.#requestJson(
            "PATCH",
            `/sessions/${encodeURIComponent(sessionId)}/model`,
            request,
        );
    }

    changeEffort(
        sessionId: string,
        request: ChangeEffortRequest,
    ): Promise<{ session: ProtocolSession }> {
        return this.#requestJson(
            "PATCH",
            `/sessions/${encodeURIComponent(sessionId)}/effort`,
            request,
        );
    }

    changePermissionMode(
        sessionId: string,
        request: ChangePermissionModeRequest,
    ): Promise<{ session: ProtocolSession }> {
        return this.#requestJson(
            "PATCH",
            `/sessions/${encodeURIComponent(sessionId)}/permissions`,
            request,
        );
    }

    changeServiceTier(
        sessionId: string,
        request: ChangeServiceTierRequest,
    ): Promise<{ session: ProtocolSession }> {
        return this.#requestJson(
            "PATCH",
            `/sessions/${encodeURIComponent(sessionId)}/service-tier`,
            request,
        );
    }

    attachSecret(
        sessionId: string,
        secretId: string,
        scope: SecretAttachmentScope = "session",
    ): Promise<SecretSessionResponse> {
        return this.#requestJson("POST", `/sessions/${encodeURIComponent(sessionId)}/secrets`, {
            scope,
            secretId,
        });
    }

    detachSecret(
        sessionId: string,
        secretId: string,
        scope: SecretAttachmentScope = "session",
    ): Promise<SecretSessionResponse> {
        return this.#requestJson(
            "DELETE",
            `/sessions/${encodeURIComponent(sessionId)}/secrets/${encodeURIComponent(secretId)}?scope=${scope}`,
        );
    }

    listSecrets(): Promise<ListSecretsResponse> {
        return this.#requestJson("GET", "/secrets");
    }

    registerSecret(request: RegisterSecretRequest): Promise<RegisterSecretResponse> {
        return this.#requestJson("POST", "/secrets", request);
    }

    unregisterSecret(secretId: string): Promise<UnregisterSecretResponse> {
        return this.#requestJson("DELETE", `/secrets/${encodeURIComponent(secretId)}`);
    }

    setGoal(sessionId: string, request: SetGoalRequest): Promise<GoalSessionResponse> {
        return this.#requestJson(
            "POST",
            `/sessions/${encodeURIComponent(sessionId)}/goal`,
            request,
        );
    }

    changeGoalStatus(
        sessionId: string,
        request: ChangeSessionGoalStatusRequest,
    ): Promise<GoalSessionResponse> {
        return this.#requestJson(
            "PATCH",
            `/sessions/${encodeURIComponent(sessionId)}/goal`,
            request,
        );
    }

    clearGoal(sessionId: string): Promise<GoalSessionResponse> {
        return this.#requestJson("DELETE", `/sessions/${encodeURIComponent(sessionId)}/goal`);
    }

    compact(sessionId: string): Promise<CompactSessionResponse> {
        return this.#requestJson("POST", `/sessions/${encodeURIComponent(sessionId)}/compact`);
    }

    createSession(request: CreateSessionRequest): Promise<CreateSessionResponse> {
        return this.#requestJson("POST", "/sessions", request);
    }

    createRemoteTerminal(
        sessionId: string,
        request: CreateRemoteTerminalRequest = {},
    ): Promise<CreateRemoteTerminalResponse> {
        return this.#requestJson(
            "POST",
            `/sessions/${encodeURIComponent(sessionId)}/terminals`,
            request,
        );
    }

    async attachRemoteTerminal(
        sessionId: string,
        terminalId: string,
        options: AttachRemoteTerminalOptions = {},
    ): Promise<RemoteTerminalAttachment> {
        const replica = options.replica ?? (await RemoteTerminalClientReplica.create());
        let stream: Duplex;
        try {
            stream = await connectRemoteTerminalWebSocket({
                path: `${this.#remoteTerminalPath(sessionId, terminalId)}/attach`,
                socketPath: this.socketPath,
                token: this.token,
            });
        } catch (error) {
            if (options.replica === undefined) replica.close();
            throw error;
        }
        const reconnect = options.reconnectState;
        const clientId = options.clientId ?? randomUUID();
        const attachment = new RemoteTerminalAttachment(
            clientId,
            replica,
            (onExit) =>
                new RemoteTerminalProtocolClient({
                    clientId,
                    ...(options.creditBytes === undefined
                        ? {}
                        : { creditBytes: options.creditBytes }),
                    ...(reconnect?.epoch === undefined ? {} : { epoch: reconnect.epoch }),
                    ...(reconnect?.inputLease === undefined
                        ? {}
                        : { inputLease: reconnect.inputLease }),
                    ...(reconnect === undefined
                        ? {}
                        : {
                              pendingInputs: reconnect.pendingInputs,
                              resumeInputSequence: reconnect.resumeInputSequence,
                              resumeOutputOffset: reconnect.resumeOutputOffset,
                          }),
                    onExit,
                    replica,
                    stream,
                }),
        );
        try {
            await attachment.protocol.ready;
            return attachment;
        } catch (error) {
            attachment.close();
            if (options.replica === undefined) replica.close();
            throw error;
        }
    }

    listRemoteTerminals(sessionId: string): Promise<ListRemoteTerminalsResponse> {
        return this.#requestJson("GET", `/sessions/${encodeURIComponent(sessionId)}/terminals`);
    }

    resizeRemoteTerminal(
        sessionId: string,
        terminalId: string,
        request: ResizeRemoteTerminalRequest,
    ): Promise<RemoteTerminalResponse> {
        return this.#requestJson("PATCH", this.#remoteTerminalPath(sessionId, terminalId), request);
    }

    stopRemoteTerminal(sessionId: string, terminalId: string): Promise<RemoteTerminalResponse> {
        return this.#requestJson("DELETE", this.#remoteTerminalPath(sessionId, terminalId));
    }

    updateSession(
        sessionId: string,
        request: UpdateSessionRequest,
    ): Promise<{ session: ProtocolSession }> {
        return this.#requestJson("PATCH", `/sessions/${encodeURIComponent(sessionId)}`, request);
    }

    forkSession(sessionId: string): Promise<ForkSessionResponse> {
        return this.#requestJson("POST", `/sessions/${encodeURIComponent(sessionId)}/fork`);
    }

    health(): Promise<HealthResponse> {
        return this.#requestJson("GET", "/health");
    }

    models(): Promise<ListModelsResponse> {
        return this.#requestJson("GET", "/models");
    }

    listSessions(limit?: number): Promise<ListSessionsResponse> {
        const path =
            limit === undefined ? "/sessions" : `/sessions?limit=${encodeURIComponent(limit)}`;
        return this.#requestJson("GET", path);
    }

    listSubagents(sessionId: string): Promise<ListSubagentsResponse> {
        return this.#requestJson("GET", `/sessions/${encodeURIComponent(sessionId)}/subagents`);
    }

    searchFiles(sessionId: string, query: string, limit = 20): Promise<SearchFilesResponse> {
        const parameters = new URLSearchParams({
            limit: String(limit),
            query,
        });
        return this.#requestJson(
            "GET",
            `/sessions/${encodeURIComponent(sessionId)}/files?${parameters.toString()}`,
        );
    }

    getSession(sessionId: string): Promise<{ session: ProtocolSession }> {
        return this.#requestJson("GET", `/sessions/${encodeURIComponent(sessionId)}`);
    }

    getSessionUsage(sessionId: string): Promise<GetSessionUsageResponse> {
        return this.#requestJson("GET", `/sessions/${encodeURIComponent(sessionId)}/usage`);
    }

    getCurrentProviderQuota(sessionId: string): Promise<GetCurrentProviderQuotaResponse> {
        return this.#requestJson(
            "GET",
            `/sessions/${encodeURIComponent(sessionId)}/current-provider-quota`,
        );
    }

    getEvents(sessionId: string, after?: EventId): Promise<{ events: SessionEvent[] }> {
        const path =
            after === undefined
                ? `/sessions/${encodeURIComponent(sessionId)}/events`
                : `/sessions/${encodeURIComponent(sessionId)}/events?after=${encodeURIComponent(after)}`;
        return this.#requestJson("GET", path);
    }

    getDaemonConfig(): Promise<GetDaemonConfigResponse> {
        return this.#requestJson("GET", "/config");
    }

    getGlobalEvents(after?: number, limit = 100): Promise<ListGlobalEventsResponse> {
        const parameters = new URLSearchParams({ limit: String(limit) });
        if (after !== undefined) parameters.set("after", String(after));
        return this.#requestJson("GET", `/events?${parameters.toString()}`);
    }

    reset(sessionId: string): Promise<{ session: ProtocolSession }> {
        return this.#requestJson("POST", `/sessions/${encodeURIComponent(sessionId)}/reset`);
    }

    recordSessionActivity(sessionId: string): Promise<RecordSessionActivityResponse> {
        return this.#requestJson("POST", `/sessions/${encodeURIComponent(sessionId)}/activity`);
    }

    rewind(sessionId: string, messageId: string): Promise<RewindSessionResponse> {
        return this.#requestJson("POST", `/sessions/${encodeURIComponent(sessionId)}/rewind`, {
            messageId,
        });
    }

    shutdown(): Promise<ShutdownServerResponse> {
        return this.#requestJson("POST", "/shutdown");
    }

    submitMessage(
        sessionId: string,
        request: SubmitMessageRequest,
    ): Promise<SubmitMessageResponse> {
        return this.#requestJson(
            "POST",
            `/sessions/${encodeURIComponent(sessionId)}/messages`,
            request,
        );
    }

    broadcastMessage(request: BroadcastMessageRequest): Promise<BroadcastMessageResponse> {
        return this.#requestJson("POST", "/messages", request);
    }

    listExternalToolCalls(sessionId: string): Promise<{ calls: readonly ExternalToolCall[] }> {
        return this.#requestJson(
            "GET",
            `/sessions/${encodeURIComponent(sessionId)}/external-tool-calls`,
        );
    }

    listPendingExternalToolCalls(limit = 100): Promise<ListExternalToolCallsResponse> {
        return this.#requestJson("GET", `/external-tool-calls?limit=${encodeURIComponent(limit)}`);
    }

    resolveExternalToolCall(
        sessionId: string,
        callId: string,
        request: ResolveExternalToolCallRequest,
    ): Promise<ResolveExternalToolCallResponse> {
        return this.#requestJson(
            "POST",
            `/sessions/${encodeURIComponent(sessionId)}/external-tool-calls/${encodeURIComponent(callId)}`,
            request,
        );
    }

    stopWorkflow(sessionId: string, runId: string): Promise<StopWorkflowResponse> {
        return this.#requestJson(
            "POST",
            `/sessions/${encodeURIComponent(sessionId)}/workflows/${encodeURIComponent(runId)}/stop`,
        );
    }

    trimGlobalEvents(through: number): Promise<TrimGlobalEventsResponse> {
        return this.#requestJson("POST", "/events/trim", { through });
    }

    updateDaemonConfig(request: UpdateDaemonConfigRequest): Promise<UpdateDaemonConfigResponse> {
        return this.#requestJson("PATCH", "/config", request);
    }

    async watchGlobalEvents(options: WatchGlobalEventsOptions): Promise<void> {
        let after = options.after;
        while (options.signal?.aborted !== true) {
            try {
                after = await this.#watchGlobalEventsOnce(after, {
                    ...options,
                    onEvent: async (entry) => {
                        await options.onEvent(entry);
                        after = entry.cursor;
                    },
                });
            } catch (error) {
                if (options.signal?.aborted) return;
                if (
                    error instanceof EventStreamHttpError &&
                    error.statusCode >= 400 &&
                    error.statusCode < 500
                ) {
                    throw error;
                }
                await delay(50, options.signal);
            }
        }
    }

    async watchSessionEvents(options: WatchSessionEventsOptions): Promise<void> {
        let after = options.after;
        while (options.signal?.aborted !== true) {
            try {
                after = await this.#watchSessionEventsOnce(after, {
                    ...options,
                    onEvent: async (event) => {
                        await options.onEvent(event);
                        after = event.id;
                    },
                });
            } catch (error) {
                if (options.signal?.aborted) {
                    return;
                }
                if (
                    error instanceof EventStreamHttpError &&
                    error.statusCode >= 400 &&
                    error.statusCode < 500
                ) {
                    throw error;
                }
                await delay(50, options.signal);
            }
        }
    }

    async #requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const headers: Record<string, string | number> = {
            accept: "application/json",
            authorization: `Bearer ${this.token}`,
        };
        if (payload !== undefined) {
            headers["content-length"] = Buffer.byteLength(payload);
            headers["content-type"] = "application/json; charset=utf-8";
        }

        return new Promise<T>((resolve, reject) => {
            const request = httpRequest(
                {
                    headers,
                    method,
                    path,
                    socketPath: this.socketPath,
                },
                (response) => {
                    const chunks: Buffer[] = [];
                    response.on("data", (chunk: Buffer | string) => {
                        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                    });
                    response.on("end", () => {
                        const text = Buffer.concat(chunks).toString("utf8");
                        if ((response.statusCode ?? 500) >= 400) {
                            reject(
                                new Error(text.length > 0 ? text : `HTTP ${response.statusCode}`),
                            );
                            return;
                        }

                        resolve((text.length === 0 ? {} : JSON.parse(text)) as T);
                    });
                },
            );
            request.on("error", reject);
            if (payload !== undefined) {
                request.write(payload);
            }
            request.end();
        });
    }

    #watchSessionEventsOnce(
        after: EventId | undefined,
        options: WatchSessionEventsOptions,
    ): Promise<EventId | undefined> {
        return new Promise<EventId | undefined>((resolve, reject) => {
            let application = Promise.resolve();
            let cursor = after;
            let terminalScheduled = false;
            const settle = (error?: unknown) => {
                if (terminalScheduled) return;
                terminalScheduled = true;
                void application.then(
                    () => (error === undefined ? resolve(cursor) : reject(error)),
                    reject,
                );
            };
            const requestPath =
                after === undefined
                    ? `/sessions/${encodeURIComponent(options.sessionId)}/stream`
                    : `/sessions/${encodeURIComponent(options.sessionId)}/stream?after=${encodeURIComponent(after)}`;
            const request = httpRequest(
                {
                    headers: {
                        accept: "text/event-stream",
                        authorization: `Bearer ${this.token}`,
                    },
                    method: "GET",
                    path: requestPath,
                    socketPath: this.socketPath,
                },
                (response) => {
                    if ((response.statusCode ?? 500) >= 400) {
                        reject(new EventStreamHttpError(response.statusCode ?? 500));
                        response.resume();
                        return;
                    }

                    let buffer = "";
                    response.setEncoding("utf8");
                    response.on("data", (chunk: string) => {
                        if (terminalScheduled) return;
                        buffer += chunk;
                        for (;;) {
                            const boundary = buffer.indexOf("\n\n");
                            if (boundary < 0) {
                                break;
                            }
                            const rawEvent = buffer.slice(0, boundary);
                            buffer = buffer.slice(boundary + 2);
                            const event = parseSseEvent(rawEvent);
                            if (event === undefined) {
                                continue;
                            }
                            application = application.then(async () => {
                                await options.onEvent(event);
                                cursor = event.id;
                            });
                            void application.catch((error: unknown) => {
                                response.destroy();
                                settle(error);
                            });
                        }
                    });
                    response.on("end", () => settle());
                    response.on("error", settle);
                },
            );
            const abort = () => {
                settle();
                request.destroy();
            };
            options.signal?.addEventListener("abort", abort, { once: true });
            request.on("error", settle);
            request.end();
        });
    }

    #remoteTerminalPath(sessionId: string, terminalId: string): string {
        return `/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(terminalId)}`;
    }

    #watchGlobalEventsOnce(
        after: number | undefined,
        options: WatchGlobalEventsOptions,
    ): Promise<number | undefined> {
        return new Promise<number | undefined>((resolve, reject) => {
            let application = Promise.resolve();
            let cursor = after;
            let terminalScheduled = false;
            const settle = (error?: unknown) => {
                if (terminalScheduled) return;
                terminalScheduled = true;
                void application.then(
                    () => (error === undefined ? resolve(cursor) : reject(error)),
                    reject,
                );
            };
            const requestPath =
                after === undefined ? "/events/stream" : `/events/stream?after=${after}`;
            const request = httpRequest(
                {
                    headers: {
                        accept: "text/event-stream",
                        authorization: `Bearer ${this.token}`,
                    },
                    method: "GET",
                    path: requestPath,
                    socketPath: this.socketPath,
                },
                (response) => {
                    if ((response.statusCode ?? 500) >= 400) {
                        reject(new EventStreamHttpError(response.statusCode ?? 500));
                        response.resume();
                        return;
                    }

                    let buffer = "";
                    response.setEncoding("utf8");
                    response.on("data", (chunk: string) => {
                        if (terminalScheduled) return;
                        buffer += chunk;
                        for (;;) {
                            const boundary = buffer.indexOf("\n\n");
                            if (boundary < 0) break;
                            const rawEvent = buffer.slice(0, boundary);
                            buffer = buffer.slice(boundary + 2);
                            const entry = parseGlobalSseEvent(rawEvent);
                            if (entry === undefined) continue;
                            application = application.then(async () => {
                                await options.onEvent(entry);
                                cursor = entry.cursor;
                            });
                            void application.catch((error: unknown) => {
                                response.destroy();
                                settle(error);
                            });
                        }
                    });
                    response.on("end", () => settle());
                    response.on("error", settle);
                },
            );
            const abort = () => {
                settle();
                request.destroy();
            };
            options.signal?.addEventListener("abort", abort, { once: true });
            request.on("error", settle);
            request.end();
        });
    }
}

function parseSseEvent(raw: string): SessionEvent | undefined {
    if (raw.startsWith(":")) {
        return undefined;
    }

    const dataLines = raw
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart());
    if (dataLines.length === 0) {
        return undefined;
    }

    return JSON.parse(dataLines.join("\n")) as SessionEvent;
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted === true) {
            resolve();
            return;
        }
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true },
        );
    });
}
