import { spawn } from "node:child_process";
import { open } from "node:fs/promises";

import {
    getLocalServerPaths,
    prepareLocalServerDirectory,
    readLocalServerToken,
    removeStaleSocket,
    writeLocalServerToken,
    type LocalServerPaths,
} from "../server/index.js";
import { ProtocolHttpClient } from "./ProtocolHttpClient.js";

export interface LocalProtocolServerConnection {
    client: ProtocolHttpClient;
    paths: LocalServerPaths;
    token: string;
}

export interface EnsureLocalProtocolServerOptions {
    onStatus?: (message: string) => void;
}

export async function ensureLocalProtocolServer(
    options: EnsureLocalProtocolServerOptions = {},
): Promise<LocalProtocolServerConnection> {
    const paths = getEnvironmentLocalServerPaths();
    await prepareLocalServerDirectory(paths.directory);
    const existingToken = await readTokenIfPresent(paths.tokenPath);
    if (existingToken !== undefined) {
        const client = new ProtocolHttpClient({
            socketPath: paths.socketPath,
            token: existingToken,
        });
        const health = await readHealth(client);
        if (health?.ready === true) {
            await waitForReady(client, options);
            return { client, paths, token: existingToken };
        }
        if (health?.healthy === true) {
            options.onStatus?.("Restarting local daemon.");
            await stopIncompatibleDaemon(client);
        }
    }

    options.onStatus?.("Starting local daemon.");
    await removeStaleSocket(paths.socketPath);
    const token = await writeLocalServerToken(paths.tokenPath);
    await spawnLocalServer(paths);
    const client = new ProtocolHttpClient({ socketPath: paths.socketPath, token });
    await waitForReady(client, options);
    return { client, paths, token };
}

function getEnvironmentLocalServerPaths(): LocalServerPaths {
    const paths = getLocalServerPaths();
    return {
        ...paths,
        socketPath: process.env.RIG_SERVER_SOCKET_PATH ?? paths.socketPath,
        tokenPath: process.env.RIG_SERVER_TOKEN_PATH ?? paths.tokenPath,
    };
}

export async function readTokenIfPresent(tokenPath: string): Promise<string | undefined> {
    try {
        return await readLocalServerToken(tokenPath);
    } catch {
        return undefined;
    }
}

async function readHealth(
    client: ProtocolHttpClient,
): Promise<Awaited<ReturnType<ProtocolHttpClient["health"]>> | undefined> {
    try {
        return await client.health();
    } catch {
        return undefined;
    }
}

async function stopIncompatibleDaemon(client: ProtocolHttpClient): Promise<void> {
    try {
        await client.shutdown();
        await delay(100);
    } catch {
        // The follow-up stale socket cleanup handles older servers that cannot shut down cleanly.
    }
}

async function spawnLocalServer(paths: LocalServerPaths): Promise<void> {
    const entrypoint = process.argv[1];
    if (entrypoint === undefined) {
        throw new Error("Cannot locate the current CLI entrypoint.");
    }

    const log = await open(paths.logPath, "a", 0o600);
    try {
        const child = spawn(process.execPath, [...process.execArgv, entrypoint, "--server"], {
            detached: true,
            env: {
                ...process.env,
                RIG_SERVER_SOCKET_PATH: paths.socketPath,
                RIG_SERVER_TOKEN_PATH: paths.tokenPath,
            },
            stdio: ["ignore", log.fd, log.fd],
        });
        child.unref();
    } finally {
        await log.close();
    }
}

async function waitForReady(
    client: ProtocolHttpClient,
    options: EnsureLocalProtocolServerOptions,
): Promise<void> {
    const deadline = Date.now() + 5_000;
    let reportedInitializing = false;
    while (Date.now() < deadline) {
        try {
            const health = await client.health();
            if (health.ready) {
                return;
            }
            if (!reportedInitializing) {
                options.onStatus?.("Waiting for daemon initialization.");
                reportedInitializing = true;
            }
        } catch {
            // The socket may not be accepting connections yet.
        }
        await delay(50);
    }

    throw new Error("Timed out while waiting for the local Rig server.");
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
