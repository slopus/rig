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

export async function ensureLocalProtocolServer(): Promise<LocalProtocolServerConnection> {
    const paths = getEnvironmentLocalServerPaths();
    await prepareLocalServerDirectory(paths.directory);
    const existingToken = await readTokenIfPresent(paths.tokenPath);
    if (existingToken !== undefined) {
        const client = new ProtocolHttpClient({
            socketPath: paths.socketPath,
            token: existingToken,
        });
        if (await isHealthy(client)) {
            return { client, paths, token: existingToken };
        }
    }

    await removeStaleSocket(paths.socketPath);
    const token = await writeLocalServerToken(paths.tokenPath);
    await spawnLocalServer(paths);
    const client = new ProtocolHttpClient({ socketPath: paths.socketPath, token });
    await waitForHealth(client);
    return { client, paths, token };
}

function getEnvironmentLocalServerPaths(): LocalServerPaths {
    const paths = getLocalServerPaths();
    return {
        ...paths,
        socketPath: process.env.OHMYPI_SERVER_SOCKET_PATH ?? paths.socketPath,
        tokenPath: process.env.OHMYPI_SERVER_TOKEN_PATH ?? paths.tokenPath,
    };
}

export async function readTokenIfPresent(tokenPath: string): Promise<string | undefined> {
    try {
        return await readLocalServerToken(tokenPath);
    } catch {
        return undefined;
    }
}

async function isHealthy(client: ProtocolHttpClient): Promise<boolean> {
    try {
        const response = await client.health();
        return response.healthy;
    } catch {
        return false;
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
                OHMYPI_SERVER_SOCKET_PATH: paths.socketPath,
                OHMYPI_SERVER_TOKEN_PATH: paths.tokenPath,
            },
            stdio: ["ignore", log.fd, log.fd],
        });
        child.unref();
    } finally {
        await log.close();
    }
}

async function waitForHealth(client: ProtocolHttpClient): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        if (await isHealthy(client)) {
            return;
        }
        await delay(50);
    }

    throw new Error("Timed out while waiting for the local Oh My Pi server.");
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
