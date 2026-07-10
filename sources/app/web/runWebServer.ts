import { access } from "node:fs/promises";
import { type Server } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getLocalServerPaths, readLocalServerToken } from "../../server/index.js";
import { createWebHttpServer } from "./createWebHttpServer.js";

export async function runWebServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    const paths = getLocalServerPaths();
    const socketPath = env.RIG_SERVER_SOCKET_PATH ?? paths.socketPath;
    const tokenPath = env.RIG_SERVER_TOKEN_PATH ?? paths.tokenPath;
    const token = await readLocalServerToken(tokenPath);
    const assetRoot = await resolveWebAssetRoot(env.RIG_WEB_ASSET_ROOT);
    const server = createWebHttpServer({ assetRoot, socketPath, token });
    const host = env.HOST ?? "127.0.0.1";
    const port = parsePort(env.PORT);

    await listen(server, port, host);
    console.log(`Rig web server is listening on ${host}:${port}.`);
}

async function resolveWebAssetRoot(configuredPath: string | undefined): Promise<string> {
    if (configuredPath !== undefined) {
        if (await hasIndexHtml(configuredPath)) {
            return configuredPath;
        }
        throw new Error(`Web assets were not found at ${configuredPath}.`);
    }

    const assetRoot = fileURLToPath(new URL("../../web/", import.meta.url));
    if (await hasIndexHtml(assetRoot)) {
        return assetRoot;
    }

    const cwdAssetRoot = resolve(process.cwd(), "dist/web");
    if (await hasIndexHtml(cwdAssetRoot)) {
        return cwdAssetRoot;
    }

    throw new Error(`Web assets were not found at ${assetRoot}. Run "pnpm build" first.`);
}

async function hasIndexHtml(assetRoot: string): Promise<boolean> {
    try {
        await access(resolve(assetRoot, "index.html"));
        return true;
    } catch {
        return false;
    }
}

function parsePort(value: string | undefined): number {
    const port = Number.parseInt(value ?? "", 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
        throw new Error("Portless did not provide a valid port for the web server.");
    }
    return port;
}

function listen(server: Server, port: number, host: string): Promise<void> {
    return new Promise<void>((resolveListen, rejectListen) => {
        const onError = (error: Error) => {
            rejectListen(error);
        };
        server.once("error", onError);
        server.listen(port, host, () => {
            server.off("error", onError);
            resolveListen();
        });
    });
}
