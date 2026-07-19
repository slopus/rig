import type { Server } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocketServer } from "ws";

import { WebSocketDuplex } from "../terminal/WebSocketDuplex.js";
import { createNodeBinaryWebSocket } from "../terminal/createNodeBinaryWebSocket.js";
import { isAuthorizedProtocolRequest } from "./isAuthorizedProtocolRequest.js";
import type { SessionStore } from "./SessionStore.js";

const MAX_WIRE_MESSAGE_BYTES = 4 * 1024 * 1024 + 20;

export function attachRemoteTerminalWebSocketServer(options: {
    server: Server;
    store: SessionStore;
    token: string;
}): void {
    const webSocketServer = new WebSocketServer({
        maxPayload: MAX_WIRE_MESSAGE_BYTES,
        noServer: true,
        perMessageDeflate: false,
    });
    options.server.on("upgrade", (request, socket, head) => {
        const route = parseAttachRoute(request.url);
        if (route === undefined) {
            rejectUpgrade(socket, 404, "Not Found");
            return;
        }
        if (!isAuthorizedProtocolRequest(request, options.token)) {
            rejectUpgrade(socket, 401, "Unauthorized");
            return;
        }
        const terminal = options.store.get(route.sessionId)?.remoteTerminal(route.terminalId);
        if (terminal === undefined) {
            rejectUpgrade(socket, 404, "Not Found");
            return;
        }
        webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
            const stream = new WebSocketDuplex(createNodeBinaryWebSocket(webSocket));
            const detach = terminal.attach(stream);
            stream.once("close", detach);
        });
    });

    const closeAllConnections = options.server.closeAllConnections.bind(options.server);
    options.server.closeAllConnections = () => {
        for (const client of webSocketServer.clients) client.terminate();
        closeAllConnections();
    };
}

function parseAttachRoute(
    requestUrl: string | undefined,
): { sessionId: string; terminalId: string } | undefined {
    try {
        const pathname = new URL(requestUrl ?? "/", "http://unix").pathname;
        const parts = pathname.split("/").filter(Boolean);
        if (
            parts.length !== 5 ||
            parts[0] !== "sessions" ||
            parts[2] !== "terminals" ||
            parts[4] !== "attach"
        ) {
            return undefined;
        }
        return {
            sessionId: decodeURIComponent(parts[1]!),
            terminalId: decodeURIComponent(parts[3]!),
        };
    } catch {
        return undefined;
    }
}

function rejectUpgrade(socket: Duplex, statusCode: number, statusText: string): void {
    socket.end(
        `HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        () => socket.destroy(),
    );
}
