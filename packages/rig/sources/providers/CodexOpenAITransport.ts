import OpenAI from "openai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { ResponsesWS } from "openai/resources/responses/ws";

import { createCodexWebSocketResponseStream } from "./createCodexWebSocketResponseStream.js";
import {
    createCodexIncrementalWebSocketRequest,
    type CodexWebSocketContinuation,
} from "./createCodexIncrementalWebSocketRequest.js";

interface CodexConnectionOptions {
    accessToken: string;
    accountId: string;
    baseUrl: string;
    sessionId?: string;
}

interface CodexResponseOptions extends CodexConnectionOptions {
    request: ResponseCreateParamsStreaming;
    signal?: AbortSignal;
    useIncrementalContext?: boolean;
}

interface CachedCodexConnection {
    client: OpenAI;
    continuation?: CodexWebSocketContinuation;
    key: string;
    socket: ResponsesWS;
}

interface CachedCodexClient {
    client: OpenAI;
    key: string;
}

export class CodexOpenAITransport {
    #activeSocket: ResponsesWS | undefined;
    #clientCache: CachedCodexClient | undefined;
    #connection: CachedCodexConnection | undefined;

    async createSseResponseStream(options: CodexResponseOptions) {
        const client = this.#client(options);
        return client.responses.create(
            options.request,
            ...(options.signal === undefined ? [] : [{ signal: options.signal }]),
        );
    }

    async *createWebSocketResponseStream(
        options: CodexResponseOptions,
    ): AsyncGenerator<ResponseStreamEvent> {
        if (this.#activeSocket !== undefined) {
            throw new Error("Codex WebSocket inference is already active for this agent.");
        }
        const connection = this.#webSocketConnection(options);
        this.#activeSocket = connection.socket;
        const fullRequest = options.request as unknown as Record<string, unknown>;
        const incremental = createCodexIncrementalWebSocketRequest(
            fullRequest,
            options.useIncrementalContext === false ? undefined : connection.continuation,
        );
        if (!incremental.continuationUsed) delete connection.continuation;
        let completedResponse = false;
        const responseItems: unknown[] = [];
        try {
            for await (const event of createCodexWebSocketResponseStream({
                client: connection.client,
                headers: this.#webSocketHeaders(options),
                request: incremental.request,
                socket: connection.socket,
                ...(options.signal === undefined ? {} : { signal: options.signal }),
            })) {
                if (event.type === "response.output_item.done") {
                    responseItems.push(event.item);
                } else if (event.type === "response.completed") {
                    completedResponse = true;
                    const response = event.response;
                    delete connection.continuation;
                    if (typeof response.id === "string" && response.id.length > 0) {
                        connection.continuation = {
                            lastRequest: fullRequest,
                            responseId: response.id,
                            responseItems,
                        };
                    }
                } else if (
                    event.type === "response.incomplete" ||
                    event.type === "response.failed" ||
                    event.type === "error"
                ) {
                    delete connection.continuation;
                }
                yield event;
            }
        } catch (error) {
            this.#discard(connection.socket, "failed");
            throw error;
        } finally {
            if (!completedResponse) this.#discard(connection.socket, "discarded");
            if (this.#activeSocket === connection.socket) this.#activeSocket = undefined;
        }
    }

    close(): void {
        const connection = this.#connection;
        this.#connection = undefined;
        this.#clientCache = undefined;
        this.#activeSocket = undefined;
        if (connection !== undefined && connection.socket.socket.readyState < 2) {
            connection.socket.close({ code: 1000, reason: "agent closed" });
        }
    }

    #client(options: CodexConnectionOptions): OpenAI {
        const key = this.#connectionKey(options);
        if (this.#clientCache?.key === key) return this.#clientCache.client;
        if (this.#connection !== undefined) {
            if (this.#connection.socket.socket.readyState < 2) {
                this.#connection.socket.close({ code: 1000, reason: "credentials changed" });
            }
            this.#connection = undefined;
        }
        const client = this.#createClient(options);
        this.#clientCache = { client, key };
        return client;
    }

    #connectionKey(options: CodexConnectionOptions): string {
        return JSON.stringify([
            options.accessToken,
            options.accountId,
            options.baseUrl,
            options.sessionId,
        ]);
    }

    #createClient(options: CodexConnectionOptions): OpenAI {
        return new OpenAI({
            apiKey: options.accessToken,
            baseURL: `${options.baseUrl.replace(/\/$/, "")}/codex`,
            defaultHeaders: {
                "chatgpt-account-id": options.accountId,
                originator: "codex_cli_rs",
                "OpenAI-Beta": "responses=experimental",
                ...(options.sessionId === undefined
                    ? {}
                    : {
                          "session-id": options.sessionId,
                          "x-client-request-id": options.sessionId,
                      }),
            },
            maxRetries: 0,
        });
    }

    #discard(socket: ResponsesWS, reason: string): void {
        if (this.#connection?.socket !== socket) return;
        this.#connection = undefined;
        if (socket.socket.readyState < 2) socket.close({ code: 1000, reason });
    }

    #webSocketConnection(options: CodexConnectionOptions): CachedCodexConnection {
        const key = this.#connectionKey(options);
        const cached = this.#connection;
        if (cached?.key === key && cached.socket.socket.readyState < 2) return cached;
        if (cached !== undefined && cached.socket.socket.readyState < 2) {
            cached.socket.close({ code: 1000, reason: "replaced" });
        }
        const client = this.#client(options);
        const connection = {
            client,
            key,
            socket: new ResponsesWS(client, { headers: this.#webSocketHeaders(options) }),
        };
        this.#connection = connection;
        return connection;
    }

    #webSocketHeaders(options: CodexConnectionOptions): Record<string, string> {
        return {
            Authorization: `Bearer ${options.accessToken}`,
            "chatgpt-account-id": options.accountId,
            originator: "codex_cli_rs",
            "OpenAI-Beta": "responses_websockets=2026-02-06",
            ...(options.sessionId === undefined
                ? {}
                : {
                      "session-id": options.sessionId,
                      "x-client-request-id": options.sessionId,
                  }),
        };
    }
}
