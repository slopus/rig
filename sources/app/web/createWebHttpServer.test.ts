import { createServer, type RequestListener, type Server } from "node:http";
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

    it("proxies API requests to the daemon socket with the local token", async () => {
        const assetRoot = await createAssetRoot("<!doctype html><main>Rig Web</main>");
        let authorization: string | undefined;
        let requestUrl: string | undefined;
        const socketPath = await createDaemonSocket((request, response) => {
            authorization = request.headers.authorization;
            requestUrl = request.url;
            response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
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
