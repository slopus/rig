import { request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

export interface WebHttpServerOptions {
    assetRoot: string;
    socketPath: string;
    token: string;
}

export function createWebHttpServer(options: WebHttpServerOptions): Server {
    return createServer((request, response) => {
        void handleWebRequest(request, response, options).catch((error: unknown) => {
            sendText(
                response,
                500,
                error instanceof Error
                    ? error.message
                    : "The web server could not handle the request.",
            );
        });
    });
}

async function handleWebRequest(
    request: IncomingMessage,
    response: ServerResponse,
    options: WebHttpServerOptions,
): Promise<void> {
    const url = new URL(request.url ?? "/", "http://web.rig.localhost");
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        proxyDaemonRequest(request, response, options, url);
        return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
        sendText(response, 405, "This route only supports browser navigation requests.");
        return;
    }

    const assetPath = resolveAssetPath(options.assetRoot, url.pathname);
    if (assetPath === undefined) {
        sendText(response, 400, "The requested path is not valid.");
        return;
    }

    if (await isFile(assetPath)) {
        await sendFile(response, request.method, assetPath);
        return;
    }

    if (extname(url.pathname).length > 0) {
        sendText(response, 404, "File not found.");
        return;
    }

    await sendFile(response, request.method, resolve(options.assetRoot, "index.html"));
}

function proxyDaemonRequest(
    request: IncomingMessage,
    response: ServerResponse,
    options: WebHttpServerOptions,
    url: URL,
): void {
    const daemonPath = `${url.pathname.slice("/api".length) || "/"}${url.search}`;
    const upstream = httpRequest(
        {
            headers: createProxyHeaders(request.headers, options.token),
            method: request.method,
            path: daemonPath,
            socketPath: options.socketPath,
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
    request.pipe(upstream);
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

function resolveAssetPath(assetRoot: string, pathname: string): string | undefined {
    let decodedPathname: string;
    try {
        decodedPathname = decodeURIComponent(pathname);
    } catch {
        return undefined;
    }

    const rootPath = resolve(assetRoot);
    const relativePath = decodedPathname.replace(/^\/+/, "") || "index.html";
    const assetPath = resolve(rootPath, relativePath);
    if (assetPath !== rootPath && !assetPath.startsWith(`${rootPath}${sep}`)) {
        return undefined;
    }
    return assetPath;
}

async function isFile(filePath: string): Promise<boolean> {
    try {
        return (await stat(filePath)).isFile();
    } catch {
        return false;
    }
}

async function sendFile(
    response: ServerResponse,
    method: string | undefined,
    filePath: string,
): Promise<void> {
    const body = await readFile(filePath);
    response.writeHead(200, {
        "cache-control": filePath.endsWith("index.html")
            ? "no-store"
            : "public, max-age=31536000, immutable",
        "content-length": body.length,
        "content-type": contentTypeForFile(filePath),
    });
    if (method !== "HEAD") {
        response.end(body);
        return;
    }
    response.end();
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

function contentTypeForFile(filePath: string): string {
    switch (extname(filePath)) {
        case ".css":
            return "text/css; charset=utf-8";
        case ".html":
            return "text/html; charset=utf-8";
        case ".ico":
            return "image/x-icon";
        case ".js":
        case ".mjs":
            return "text/javascript; charset=utf-8";
        case ".json":
            return "application/json; charset=utf-8";
        case ".png":
            return "image/png";
        case ".svg":
            return "image/svg+xml";
        case ".webp":
            return "image/webp";
        default:
            return "application/octet-stream";
    }
}
