import type OpenAI from "openai";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import type { ResponsesWS } from "openai/resources/responses/ws";

import { stampCodexWebSocketRequest } from "@/vendors/codex/impl/stampCodexWebSocketRequest.js";
import type { CodexResponseRequest } from "@/vendors/codex/impl/CodexResponseRequest.js";

export async function* createCodexWebSocketStream(options: {
    client: OpenAI;
    request: CodexResponseRequest;
    socket: ResponsesWS;
    signal?: AbortSignal;
    turnState?: string;
}): AsyncGenerator<ResponseStreamEvent> {
    if (options.signal?.aborted) throw new DOMException("Request was aborted", "AbortError");
    const iterator = options.socket[Symbol.asyncIterator]();
    const abort = (): void => options.socket.close({ code: 1000, reason: "aborted" });
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
        options.socket.send({
            type: "response.create",
            ...stampCodexWebSocketRequest(options.request, options.turnState),
        } as never);
        for (;;) {
            const item = await iterator.next();
            if (item.done) return;
            if (item.value.type === "error") throw item.value.error;
            if (item.value.type === "close") {
                if (options.signal?.aborted)
                    throw new DOMException("Request was aborted", "AbortError");
                throw new Error(
                    `Codex WebSocket closed before completion with code ${item.value.code}.`,
                );
            }
            if (item.value.type !== "message") continue;
            const event = item.value.message as ResponseStreamEvent;
            yield event;
            if (
                ["response.completed", "response.incomplete", "response.failed", "error"].includes(
                    event.type,
                )
            )
                return;
        }
    } finally {
        options.signal?.removeEventListener("abort", abort);
        await iterator.return?.();
    }
}
