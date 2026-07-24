import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";

import { createGym, type Gym } from "@slopus/rig-gym";

const runningGyms = new Set<Gym>();
const runningServers = new Set<CodexWebSocketFixture>();

afterEach(async () => {
    await Promise.all([...runningGyms].map((gym) => gym.dispose()));
    runningGyms.clear();
    await Promise.all([...runningServers].map((server) => server.close()));
    runningServers.clear();
});

describe("Codex WebSocket cancellation", () => {
    it("reconnects after Escape and keeps the daemon usable", async () => {
        const codex = await createCodexWebSocketFixture();
        runningServers.add(codex);
        const gym = await createGym({
            environment: {
                RIG_CODEX_BASE_URL: codex.baseUrl,
                RIG_CODEX_TRANSPORT: "websocket",
            },
            homeFiles: { ".codex/auth.json": codexAuth() },
            modelId: "openai/gpt-5.6-sol",
            providerId: "codex",
            rows: 38,
        });
        runningGyms.add(gym);

        submit(gym, "Start a response that I will interrupt.");
        await gym.terminal.waitForText("PARTIAL_BEFORE_ABORT", 30_000);
        gym.terminal.press("escape");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Session interrupted") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "the Codex turn to settle after Escape",
            30_000,
        );

        submit(gym, "Confirm this Codex session still works.");
        const recovered = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("CODEX_SESSION_RECOVERED") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "the same Codex session to respond after reconnecting",
            30_000,
        );

        expect(recovered.text).toContain("CODEX_SESSION_RECOVERED");
        expect(codex.mainRequests()).toBe(2);
        expect(codex.connections()).toBeGreaterThanOrEqual(2);
    }, 120_000);
});

interface CodexWebSocketFixture {
    baseUrl: string;
    close(): Promise<void>;
    connections(): number;
    mainRequests(): number;
}

async function createCodexWebSocketFixture(): Promise<CodexWebSocketFixture> {
    const server = createServer((_request, response) => {
        response.writeHead(404);
        response.end();
    });
    const webSockets = new WebSocketServer({ server });
    const clients = new Set<WebSocket>();
    let connectionCount = 0;
    let mainRequestCount = 0;
    webSockets.on("connection", (socket) => {
        connectionCount += 1;
        clients.add(socket);
        socket.on("close", () => clients.delete(socket));
        socket.on("message", (data) => {
            const request = JSON.parse(data.toString()) as {
                generate?: boolean;
                input?: unknown;
            };
            if (request.generate === false) {
                sendCompletedResponse(socket, "warmup", "");
                return;
            }
            const input = JSON.stringify(request.input);
            if (input.includes("Confirm this Codex session still works.")) {
                mainRequestCount += 1;
                sendCompletedResponse(socket, "recovered", "CODEX_SESSION_RECOVERED");
                return;
            }
            if (input.includes("Start a response that I will interrupt.")) {
                mainRequestCount += 1;
                sendPartialResponse(socket, "interrupted", "PARTIAL_BEFORE_ABORT");
                return;
            }
            sendCompletedResponse(socket, "auxiliary", "Codex session");
        });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    return {
        baseUrl: `http://127.0.0.1:${port}/backend-api`,
        close: async () => {
            for (const client of clients) client.terminate();
            await closeWebSocketServer(webSockets);
            await closeHttpServer(server);
        },
        connections: () => connectionCount,
        mainRequests: () => mainRequestCount,
    };
}

function sendPartialResponse(socket: WebSocket, id: string, text: string): void {
    const item = responseItem(id, text, "in_progress");
    socket.send(
        JSON.stringify({
            type: "response.output_item.added",
            output_index: 0,
            item: { ...item, content: [] },
        }),
    );
    socket.send(
        JSON.stringify({
            type: "response.output_text.delta",
            output_index: 0,
            content_index: 0,
            item_id: item.id,
            delta: text,
        }),
    );
}

function sendCompletedResponse(socket: WebSocket, id: string, text: string): void {
    const item = responseItem(id, text, "completed");
    if (text.length > 0) {
        socket.send(
            JSON.stringify({
                type: "response.output_item.added",
                output_index: 0,
                item: { ...item, content: [] },
            }),
        );
        socket.send(
            JSON.stringify({
                type: "response.output_text.delta",
                output_index: 0,
                content_index: 0,
                item_id: item.id,
                delta: text,
            }),
        );
        socket.send(
            JSON.stringify({
                type: "response.output_item.done",
                output_index: 0,
                item,
            }),
        );
    }
    socket.send(
        JSON.stringify({
            type: "response.completed",
            response: {
                id: `response-${id}`,
                output: text.length === 0 ? [] : [item],
                usage: {
                    input_tokens: 1,
                    output_tokens: text.length === 0 ? 0 : 1,
                    total_tokens: text.length === 0 ? 1 : 2,
                },
            },
        }),
    );
}

function responseItem(id: string, text: string, status: "completed" | "in_progress") {
    return {
        id: `message-${id}`,
        type: "message",
        role: "assistant",
        status,
        content: [{ type: "output_text", text, annotations: [] }],
    };
}

function codexAuth(): string {
    const token = [
        Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
        Buffer.from(
            JSON.stringify({
                "https://api.openai.com/auth": { chatgpt_account_id: "codex-abort-gym" },
            }),
        ).toString("base64url"),
        "signature",
    ].join(".");
    return JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: token } });
}

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function closeWebSocketServer(server: WebSocketServer): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error === undefined) resolve();
            else reject(error);
        });
    });
}

function closeHttpServer(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error === undefined) resolve();
            else reject(error);
        });
    });
}
