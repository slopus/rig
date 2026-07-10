import { readFileSync } from "node:fs";
import {
    request as httpRequest,
    type IncomingHttpHeaders,
    type IncomingMessage,
    type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Plugin } from "vite";

export function rigDaemonProxyPlugin(): Plugin {
    return {
        name: "rig-daemon-proxy",
        configureServer(server) {
            server.middlewares.use("/api", (request, response) => {
                proxyDaemonRequest(request, response);
            });
        },
    };
}

function proxyDaemonRequest(request: IncomingMessage, response: ServerResponse): void {
    const paths = getLocalServerPaths();
    const token = readLocalServerToken(paths.tokenPath);
    if (token === undefined) {
        sendText(
            response,
            502,
            "The local daemon is not available. Start it with 'pnpm dev daemon start'.",
        );
        return;
    }

    const daemonPath = normalizeDaemonPath(request.url ?? "/");
    const upstream = httpRequest(
        {
            headers: createProxyHeaders(request.headers, token),
            method: request.method,
            path: daemonPath,
            socketPath: paths.socketPath,
        },
        (upstreamResponse) => {
            response.writeHead(
                upstreamResponse.statusCode ?? 502,
                upstreamResponse.statusMessage,
                sanitizeProxyHeaders(upstreamResponse.headers),
            );
            upstreamResponse.pipe(response);
        },
    );

    upstream.on("error", () => {
        if (response.headersSent) {
            response.destroy();
            return;
        }
        sendText(response, 502, "The local daemon is not available.");
    });
    request.on("aborted", () => upstream.destroy());
    request.pipe(upstream);
}

function normalizeDaemonPath(url: string): string {
    const parsed = new URL(url, "http://web.rig.localhost");
    if (parsed.pathname === "/api" || parsed.pathname.startsWith("/api/")) {
        return `${parsed.pathname.slice("/api".length) || "/"}${parsed.search}`;
    }
    return `${parsed.pathname || "/"}${parsed.search}`;
}

function getLocalServerPaths(): { socketPath: string; tokenPath: string } {
    const directory = join(tmpdir(), `rig-${process.getuid?.() ?? 0}`);
    return {
        socketPath: process.env.RIG_SERVER_SOCKET_PATH ?? join(directory, "server.sock"),
        tokenPath: process.env.RIG_SERVER_TOKEN_PATH ?? join(directory, "token"),
    };
}

function readLocalServerToken(tokenPath: string): string | undefined {
    try {
        return readFileSync(tokenPath, "utf8").trim();
    } catch {
        return undefined;
    }
}

function createProxyHeaders(headers: IncomingHttpHeaders, token: string): IncomingHttpHeaders {
    const proxyHeaders: IncomingHttpHeaders = { ...headers };
    delete proxyHeaders.authorization;
    delete proxyHeaders.connection;
    delete proxyHeaders.host;
    proxyHeaders.authorization = `Bearer ${token}`;
    return proxyHeaders;
}

function sanitizeProxyHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
    const responseHeaders: IncomingHttpHeaders = { ...headers };
    delete responseHeaders.connection;
    delete responseHeaders["keep-alive"];
    delete responseHeaders["proxy-authenticate"];
    delete responseHeaders["proxy-authorization"];
    delete responseHeaders.te;
    delete responseHeaders.trailer;
    delete responseHeaders["transfer-encoding"];
    delete responseHeaders.upgrade;
    return responseHeaders;
}

function sendText(response: ServerResponse, statusCode: number, message: string): void {
    if (response.headersSent) {
        return;
    }
    response.writeHead(statusCode, {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
    });
    response.end(message);
}
