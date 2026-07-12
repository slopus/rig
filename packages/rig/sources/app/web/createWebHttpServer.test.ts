import {
    createServer,
    request as sendHttpRequest,
    type IncomingHttpHeaders,
    type RequestListener,
    type Server,
} from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createWebHttpServer } from "./createWebHttpServer.js";

const servers: Server[] = [];
const tempDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => closeServer(server)));
    await Promise.all(
        tempDirectories
            .splice(0)
            .map((directory) => rm(directory, { force: true, recursive: true })),
    );
});

describe("createWebHttpServer", () => {
    it("serves the built SPA with navigation fallback", async () => {
        const assetRoot = await createAssetRoot("<!doctype html><main>Rig Web</main>");
        const socketPath = await createDaemonSocket(() => {
            throw new Error("The daemon should not receive static asset requests.");
        });
        const server = await listen(
            createWebHttpServer({ assetRoot, socketPath, token: "secret" }),
        );

        const response = await fetch(`${server.origin}/sessions/example`);
        const text = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(text).toContain("Rig Web");
    });

    it("prevents framing, referrer leaks, and model-authored remote image requests", async () => {
        const assetRoot = await createAssetRoot(
            '<!doctype html><main>Rig Web</main><img src="https://tracking.invalid/model.png">',
        );
        const socketPath = await createDaemonSocket(() => {
            throw new Error("The daemon should not receive static asset requests.");
        });
        const server = await listen(
            createWebHttpServer({ assetRoot, socketPath, token: "secret" }),
        );

        const response = await fetch(server.origin);
        const contentSecurityPolicy = response.headers.get("content-security-policy");

        expect(response.status).toBe(200);
        expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
        expect(contentSecurityPolicy).toContain("img-src data: blob:");
        expect(contentSecurityPolicy).not.toContain("img-src 'self'");
        expect(contentSecurityPolicy).not.toContain("img-src https:");
        expect(contentSecurityPolicy).not.toContain("img-src *");
        expect(response.headers.get("x-frame-options")).toBe("DENY");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    });

    it("proxies API requests to the daemon socket with the local token", async () => {
        const assetRoot = await createAssetRoot("<!doctype html><main>Rig Web</main>");
        let authorization: string | undefined;
        let requestUrl: string | undefined;
        const socketPath = await createDaemonSocket((request, response) => {
            authorization = request.headers.authorization;
            requestUrl = request.url;
            response.writeHead(200, {
                "content-security-policy": "default-src *; frame-ancestors *",
                "content-type": "application/json; charset=utf-8",
                "referrer-policy": "unsafe-url",
                "x-frame-options": "SAMEORIGIN",
            });
            response.end(JSON.stringify({ healthy: true, ready: true, status: "ready" }));
        });
        const server = await listen(
            createWebHttpServer({ assetRoot, socketPath, token: "secret" }),
        );

        const response = await fetch(`${server.origin}/api/health?fresh=1`);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body).toEqual({ healthy: true, ready: true, status: "ready" });
        expect(authorization).toBe("Bearer secret");
        expect(requestUrl).toBe("/health?fresh=1");
        expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.get("x-frame-options")).toBe("DENY");
    });

    it("proxies same-origin state-changing API requests", async () => {
        const assetRoot = await createAssetRoot("<!doctype html><main>Rig Web</main>");
        let authorization: string | undefined;
        let body = "";
        const socketPath = await createDaemonSocket((request, response) => {
            authorization = request.headers.authorization;
            request.setEncoding("utf8");
            request.on("data", (chunk: string) => {
                body += chunk;
            });
            request.on("end", () => {
                response.writeHead(204);
                response.end();
            });
        });
        const server = await listen(
            createWebHttpServer({ assetRoot, socketPath, token: "secret" }),
        );

        const response = await fetch(`${server.origin}/api/sessions`, {
            body: '{"prompt":"hello"}',
            headers: {
                "content-type": "application/json",
                origin: server.origin,
            },
            method: "POST",
        });

        expect(response.status).toBe(204);
        expect(authorization).toBe("Bearer secret");
        expect(body).toBe('{"prompt":"hello"}');

        body = "";
        const portlessResponse = await requestWebServer(server.origin, "/api/sessions", {
            body: "{}",
            headers: {
                host: "web.rig.localhost",
                origin: "https://web.rig.localhost",
            },
            method: "POST",
        });

        expect(portlessResponse.statusCode).toBe(204);
        expect(authorization).toBe("Bearer secret");
        expect(body).toBe("{}");
    });

    it.each([
        {
            headers: { origin: "https://attacker.example" },
            name: "a foreign browser origin",
        },
        {
            headers: { host: "attacker.example", origin: "https://attacker.example" },
            name: "an attacker-controlled host",
        },
        {
            headers: {},
            name: "a mutation without a browser origin",
        },
        {
            headers: { origin: "null" },
            name: "an opaque browser origin",
        },
        {
            headers: {
                origin: "__SERVER_ORIGIN__",
                "sec-fetch-site": "cross-site",
            },
            name: "an explicitly cross-site browser request",
        },
        {
            headers: {
                origin: "__SERVER_ORIGIN__",
                "x-forwarded-for": "203.0.113.42",
            },
            name: "a request forwarded from another machine",
        },
    ])("rejects $name before authenticating to the daemon", async ({ headers }) => {
        const assetRoot = await createAssetRoot("<!doctype html><main>Rig Web</main>");
        let daemonRequestCount = 0;
        const socketPath = await createDaemonSocket((_request, response) => {
            daemonRequestCount += 1;
            response.writeHead(204);
            response.end();
        });
        const server = await listen(
            createWebHttpServer({ assetRoot, socketPath, token: "secret" }),
        );
        const resolvedHeaders = Object.fromEntries(
            Object.entries(headers).map(([name, value]) => [
                name,
                value === "__SERVER_ORIGIN__" ? server.origin : value,
            ]),
        );

        const response = await requestWebServer(server.origin, "/api/sessions", {
            body: "{}",
            headers: resolvedHeaders,
            method: "POST",
        });

        expect(response.statusCode).toBe(403);
        expect(response.body).toContain("Rig rejected this API request");
        expect(daemonRequestCount).toBe(0);
    });
});

async function createAssetRoot(indexHtml: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "rig-web-assets-"));
    tempDirectories.push(directory);
    await writeFile(join(directory, "index.html"), indexHtml);
    return directory;
}

async function createDaemonSocket(listener: RequestListener): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "rig-web-daemon-"));
    tempDirectories.push(directory);
    const socketPath = join(directory, "server.sock");
    const server = createServer(listener);
    await listen(server, socketPath);
    return socketPath;
}

async function listen(
    server: Server,
    portOrPath: number | string = 0,
): Promise<{ origin: string; server: Server }> {
    await new Promise<void>((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        if (typeof portOrPath === "string") {
            server.listen(portOrPath, resolveListen);
            return;
        }
        server.listen(portOrPath, "127.0.0.1", resolveListen);
    });
    servers.push(server);
    const address = server.address();
    if (address === null || typeof address === "string") {
        return { origin: "http://unix", server };
    }
    return { origin: `http://127.0.0.1:${address.port}`, server };
}

function closeServer(server: Server): Promise<void> {
    return new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
            if (error === undefined) {
                resolveClose();
                return;
            }
            rejectClose(error);
        });
    });
}

function requestWebServer(
    origin: string,
    path: string,
    options: {
        body?: string;
        headers?: IncomingHttpHeaders;
        method?: string;
    },
): Promise<{ body: string; headers: IncomingHttpHeaders; statusCode: number }> {
    return new Promise((resolveRequest, rejectRequest) => {
        const request = sendHttpRequest(
            new URL(path, origin),
            { headers: options.headers, method: options.method },
            (response) => {
                let body = "";
                response.setEncoding("utf8");
                response.on("data", (chunk: string) => {
                    body += chunk;
                });
                response.on("end", () => {
                    resolveRequest({
                        body,
                        headers: response.headers,
                        statusCode: response.statusCode ?? 0,
                    });
                });
            },
        );
        request.once("error", rejectRequest);
        request.end(options.body);
    });
}
