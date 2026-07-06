import { request as httpRequest } from "node:http";

import type {
    AbortRunResponse,
    ChangeModelRequest,
    CreateSessionRequest,
    CreateSessionResponse,
    EventId,
    ListSessionsResponse,
    ProtocolSession,
    SessionEvent,
    ShutdownServerResponse,
    SubmitMessageRequest,
    SubmitMessageResponse,
} from "../protocol/index.js";

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

export class ProtocolHttpClient {
    readonly socketPath: string;
    readonly token: string;

    constructor(options: ProtocolHttpClientOptions) {
        this.socketPath = options.socketPath;
        this.token = options.token;
    }

    abort(sessionId: string): Promise<AbortRunResponse> {
        return this.#requestJson("POST", `/sessions/${encodeURIComponent(sessionId)}/abort`);
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

    createSession(request: CreateSessionRequest): Promise<CreateSessionResponse> {
        return this.#requestJson("POST", "/sessions", request);
    }

    health(): Promise<{ healthy: boolean }> {
        return this.#requestJson("GET", "/health");
    }

    listSessions(limit?: number): Promise<ListSessionsResponse> {
        const path =
            limit === undefined ? "/sessions" : `/sessions?limit=${encodeURIComponent(limit)}`;
        return this.#requestJson("GET", path);
    }

    getSession(sessionId: string): Promise<{ session: ProtocolSession }> {
        return this.#requestJson("GET", `/sessions/${encodeURIComponent(sessionId)}`);
    }

    getEvents(sessionId: string, after?: EventId): Promise<{ events: SessionEvent[] }> {
        const path =
            after === undefined
                ? `/sessions/${encodeURIComponent(sessionId)}/events`
                : `/sessions/${encodeURIComponent(sessionId)}/events?after=${encodeURIComponent(after)}`;
        return this.#requestJson("GET", path);
    }

    reset(sessionId: string): Promise<{ session: ProtocolSession }> {
        return this.#requestJson("POST", `/sessions/${encodeURIComponent(sessionId)}/reset`);
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

    async watchSessionEvents(options: WatchSessionEventsOptions): Promise<void> {
        let after = options.after;
        while (options.signal?.aborted !== true) {
            try {
                after = await this.#watchSessionEventsOnce(after, options);
            } catch {
                if (options.signal?.aborted) {
                    return;
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
                        reject(new Error(`SSE failed with HTTP ${response.statusCode}`));
                        response.resume();
                        return;
                    }

                    let cursor = after;
                    let buffer = "";
                    response.setEncoding("utf8");
                    response.on("data", (chunk: string) => {
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
                            cursor = event.id;
                            Promise.resolve(options.onEvent(event)).catch(reject);
                        }
                    });
                    response.on("end", () => resolve(cursor));
                    response.on("error", reject);
                },
            );
            const abort = () => {
                request.destroy();
                resolve(after);
            };
            options.signal?.addEventListener("abort", abort, { once: true });
            request.on("error", reject);
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
