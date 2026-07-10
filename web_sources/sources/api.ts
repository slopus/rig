/**
 * Typed client for the daemon HTTP protocol.
 *
 * All requests go through the web server proxy at `/api/*`; the proxy injects
 * authentication, so the browser sends no auth header.
 */

import type {
    AbortRunResponse,
    ChangeEffortRequest,
    ChangeEffortResponse,
    ChangeModelRequest,
    ChangeModelResponse,
    CreateSessionRequest,
    CreateSessionResponse,
    EventId,
    GetSessionResponse,
    HealthResponse,
    ListModelsResponse,
    ListSessionsResponse,
    ListSubagentsResponse,
    ResetSessionResponse,
    SearchFilesResponse,
    SessionEvent,
    SubmitMessageRequest,
    SubmitMessageResponse,
} from "./protocol";

const API_BASE = "/api";

const RECONNECT_DELAY_MS = 300;

async function readErrorDetail(response: Response): Promise<string> {
    try {
        const text = await response.text();
        if (text.length === 0) {
            return response.statusText;
        }
        try {
            const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
            if (typeof parsed.error === "string") {
                return parsed.error;
            }
            if (typeof parsed.message === "string") {
                return parsed.message;
            }
        } catch {
            // Not JSON — fall through to the raw text.
        }
        return text;
    } catch {
        return response.statusText;
    }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, init);
    if (!response.ok) {
        const detail = await readErrorDetail(response);
        throw new Error(`Request to ${path} failed (${response.status}): ${detail}`);
    }
    return (await response.json()) as T;
}

function postJson<T>(path: string, body?: unknown): Promise<T> {
    return requestJson<T>(path, {
        method: "POST",
        ...(body !== undefined
            ? {
                  body: JSON.stringify(body),
                  headers: { "Content-Type": "application/json" },
              }
            : {}),
    });
}

function patchJson<T>(path: string, body: unknown): Promise<T> {
    return requestJson<T>(path, {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
    });
}

export function fetchHealth(): Promise<HealthResponse> {
    return requestJson<HealthResponse>("/health");
}

export function fetchModels(): Promise<ListModelsResponse> {
    return requestJson<ListModelsResponse>("/models");
}

export function fetchSessions(limit?: number): Promise<ListSessionsResponse> {
    const query = limit !== undefined ? `?limit=${limit}` : "";
    return requestJson<ListSessionsResponse>(`/sessions${query}`);
}

export function fetchSubagents(sessionId: string): Promise<ListSubagentsResponse> {
    return requestJson<ListSubagentsResponse>(
        `/sessions/${encodeURIComponent(sessionId)}/subagents`,
    );
}

export function searchFiles(
    sessionId: string,
    query: string,
    limit = 20,
    signal?: AbortSignal,
): Promise<SearchFilesResponse> {
    const parameters = new URLSearchParams({
        limit: String(limit),
        query,
    });
    return requestJson<SearchFilesResponse>(
        `/sessions/${encodeURIComponent(sessionId)}/files?${parameters.toString()}`,
        signal === undefined ? undefined : { signal },
    );
}

export function createSession(request: CreateSessionRequest): Promise<CreateSessionResponse> {
    return postJson<CreateSessionResponse>("/sessions", request);
}

export function fetchSession(sessionId: string): Promise<GetSessionResponse> {
    return requestJson<GetSessionResponse>(`/sessions/${encodeURIComponent(sessionId)}`);
}

export function submitMessage(
    sessionId: string,
    request: SubmitMessageRequest,
): Promise<SubmitMessageResponse> {
    return postJson<SubmitMessageResponse>(
        `/sessions/${encodeURIComponent(sessionId)}/messages`,
        request,
    );
}

export function abortRun(sessionId: string): Promise<AbortRunResponse> {
    return postJson<AbortRunResponse>(`/sessions/${encodeURIComponent(sessionId)}/abort`);
}

export function resetSession(sessionId: string): Promise<ResetSessionResponse> {
    return postJson<ResetSessionResponse>(`/sessions/${encodeURIComponent(sessionId)}/reset`);
}

export function changeSessionModel(
    sessionId: string,
    request: ChangeModelRequest,
): Promise<ChangeModelResponse> {
    return patchJson<ChangeModelResponse>(
        `/sessions/${encodeURIComponent(sessionId)}/model`,
        request,
    );
}

export function changeSessionEffort(
    sessionId: string,
    request: ChangeEffortRequest,
): Promise<ChangeEffortResponse> {
    return patchJson<ChangeEffortResponse>(
        `/sessions/${encodeURIComponent(sessionId)}/effort`,
        request,
    );
}

function parseSseChunk(chunk: string): SessionEvent | undefined {
    const dataLines: string[] = [];
    for (const rawLine of chunk.split("\n")) {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
        }
        // Lines starting with ":" are keep-alive comments; ignore everything else.
    }
    if (dataLines.length === 0) {
        return undefined;
    }
    try {
        return JSON.parse(dataLines.join("\n")) as SessionEvent;
    } catch {
        return undefined;
    }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve();
            return;
        }
        const timer = window.setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            window.clearTimeout(timer);
            resolve();
        };
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

export interface StreamSessionEventsOptions {
    /**
     * Called when the daemon no longer knows the `after` cursor (HTTP 409,
     * e.g. its event log was wiped). Should reseed local state from
     * `GET /api/sessions/:id` and return the fresh cursor to reconnect with;
     * returning undefined replays the full event log. When omitted, the
     * stream falls back to replaying from the beginning.
     */
    onCursorInvalid?: () => Promise<EventId | undefined>;
    /**
     * Called when the daemon permanently rejects the stream (any other 4xx,
     * e.g. the session id is no longer known). The reconnect loop stops.
     */
    onStreamRejected?: (status: number) => void;
}

/**
 * Subscribes to a session's SSE stream with automatic reconnection.
 *
 * Uses `fetch` + ReadableStream (not EventSource) so each reconnect can carry
 * the `after` cursor of the last event seen. Resolves once `signal` aborts or
 * the daemon permanently rejects the stream with a 4xx response.
 */
export async function streamSessionEvents(
    sessionId: string,
    after: EventId | undefined,
    onEvent: (event: SessionEvent) => void,
    signal: AbortSignal,
    options?: StreamSessionEventsOptions,
): Promise<void> {
    let cursor = after;

    while (!signal.aborted) {
        let rejected = false;
        try {
            const query = cursor !== undefined ? `?after=${encodeURIComponent(cursor)}` : "";
            const response = await fetch(
                `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/stream${query}`,
                {
                    headers: { Accept: "text/event-stream" },
                    signal,
                },
            );
            if (response.status === 409) {
                // The cursor is not in the daemon's event log anymore: reseed
                // instead of retrying the same cursor forever.
                cursor =
                    options?.onCursorInvalid !== undefined
                        ? await options.onCursorInvalid()
                        : undefined;
            } else if (!response.ok || response.body === null) {
                if (response.status >= 400 && response.status < 500) {
                    rejected = true;
                    options?.onStreamRejected?.(response.status);
                }
                throw new Error(`Stream request failed (${response.status})`);
            } else {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) {
                        break;
                    }
                    buffer += decoder.decode(value, { stream: true });

                    let separatorIndex = buffer.indexOf("\n\n");
                    while (separatorIndex !== -1) {
                        const chunk = buffer.slice(0, separatorIndex);
                        buffer = buffer.slice(separatorIndex + 2);
                        const event = parseSseChunk(chunk);
                        if (event !== undefined) {
                            cursor = event.id;
                            onEvent(event);
                        }
                        separatorIndex = buffer.indexOf("\n\n");
                    }
                }
            }
        } catch {
            // Swallow network errors; the loop below decides whether to retry.
        }

        if (rejected || signal.aborted) {
            return;
        }
        await delay(RECONNECT_DELAY_MS, signal);
    }
}
