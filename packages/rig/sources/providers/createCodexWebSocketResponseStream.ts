import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import type OpenAI from "openai";
import { ResponsesWS } from "openai/resources/responses/ws";

export async function* createCodexWebSocketResponseStream(options: {
    client: OpenAI;
    headers: Readonly<Record<string, string>>;
    request: Record<string, unknown>;
    signal?: AbortSignal;
    socket?: ResponsesWS;
    timeoutMs?: number;
}): AsyncGenerator<ResponseStreamEvent> {
    if (options.signal?.aborted === true) {
        throw new DOMException("Request was aborted", "AbortError");
    }
    const ownsSocket = options.socket === undefined;
    const socket = options.socket ?? new ResponsesWS(options.client, { headers: options.headers });
    const iterator = socket[Symbol.asyncIterator]();
    const timeoutMs = Math.max(0, options.timeoutMs ?? options.client.timeout);
    let aborted = false;
    let closeRequested = false;
    const abort = (): void => {
        aborted = true;
        closeRequested = true;
        socket.close({ code: 1000, reason: "aborted" });
    };
    options.signal?.addEventListener("abort", abort, { once: true });

    try {
        socket.send({
            type: "response.create",
            ...options.request,
        } as never);
        for (;;) {
            let timeout: ReturnType<typeof setTimeout> | undefined;
            const next = iterator.next();
            const itemResult = await Promise.race([
                next,
                new Promise<never>((_resolve, reject) => {
                    timeout = setTimeout(() => {
                        closeRequested = true;
                        socket.close({ code: 1000, reason: "timeout" });
                        reject(
                            new Error(
                                `Codex WebSocket timed out after ${timeoutMs}ms without receiving a response event.`,
                            ),
                        );
                    }, timeoutMs);
                }),
            ]).finally(() => clearTimeout(timeout));
            if (itemResult.done) return;
            const item = itemResult.value;
            if (item.type === "error") {
                if (aborted) {
                    throw new DOMException("Request was aborted", "AbortError");
                }
                throw item.error;
            }
            if (item.type === "close") {
                closeRequested = true;
                if (item.reason === "aborted" || aborted) {
                    throw new DOMException("Request was aborted", "AbortError");
                }
                throw new Error(
                    `Codex WebSocket closed before a terminal response with code ${item.code}${item.reason.length === 0 ? "" : `: ${item.reason}`}.`,
                );
            }
            if (item.type !== "message") {
                continue;
            }
            const event = item.message as ResponseStreamEvent;
            yield event;
            if (
                event.type === "response.completed" ||
                event.type === "response.incomplete" ||
                event.type === "response.failed" ||
                event.type === "error"
            ) {
                return;
            }
        }
    } finally {
        options.signal?.removeEventListener("abort", abort);
        await iterator.return?.();
        if (ownsSocket && !closeRequested) socket.close({ code: 1000, reason: "done" });
    }
}
