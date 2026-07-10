import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../protocol/index.js";
import { ProtocolHttpClient } from "./ProtocolHttpClient.js";

describe("ProtocolHttpClient", () => {
    it("reconnects SSE streams from the last received event id", async () => {
        const directory = await mkdtemp(join(tmpdir(), "rig-client-test-"));
        const socketPath = join(directory, "server.sock");
        const first = sessionResetEvent("018bcfe5-6800-7001-8000-000000000001");
        const second = sessionResetEvent("018bcfe5-6800-7002-8000-000000000002");
        const requestedAfterValues: Array<string | null> = [];
        let streamRequests = 0;
        const server = createServer((request, response) => {
            expect(request.headers.authorization).toBe("Bearer test-token");
            const url = new URL(request.url ?? "/", "http://unix");
            requestedAfterValues.push(url.searchParams.get("after"));
            streamRequests += 1;
            response.writeHead(200, {
                "content-type": "text/event-stream; charset=utf-8",
            });
            if (streamRequests === 1) {
                writeSseEvent(response, first);
                response.end();
                return;
            }

            writeSseEvent(response, second);
        });

        try {
            await new Promise<void>((resolve) => server.listen(socketPath, resolve));
            const client = new ProtocolHttpClient({ socketPath, token: "test-token" });
            const controller = new AbortController();
            const received: SessionEvent[] = [];

            await client.watchSessionEvents({
                sessionId: "session-1",
                signal: controller.signal,
                onEvent(event) {
                    received.push(event);
                    if (received.length === 2) {
                        controller.abort();
                    }
                },
            });

            expect(received.map((event) => event.id)).toEqual([first.id, second.id]);
            expect(requestedAfterValues).toEqual([null, first.id]);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
            await rm(directory, { recursive: true, force: true });
        }
    });
});

function sessionResetEvent(id: string): SessionEvent {
    return {
        createdAt: 1_700_000_000_000,
        data: {
            snapshot: {
                id: "agent-1",
                messages: [],
                modelId: "openai/gpt-5.5",
                providerId: "codex",
                queue: [],
                status: "idle",
                tools: [],
            },
        },
        id,
        sessionId: "session-1",
        type: "session_reset",
    };
}

function writeSseEvent(response: { write(data: string): void }, event: SessionEvent): void {
    response.write(`id: ${event.id}\n`);
    response.write(`event: ${event.type}\n`);
    response.write(`data: ${JSON.stringify(event)}\n\n`);
}
