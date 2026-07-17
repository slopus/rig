import { spawn } from "node:child_process";
import { open } from "node:fs/promises";

import {
    getEnvironmentLocalServerPaths,
    prepareLocalServerDirectory,
    readLocalServerProcessId,
    readLocalServerToken,
    removeStaleSocket,
    writeLocalServerToken,
    type LocalServerPaths,
} from "../server/index.js";
import { daemonIdentitiesMatch, getDaemonIdentity } from "../daemon/index.js";
import type { DaemonIdentity } from "../protocol/index.js";
import { ProtocolHttpClient } from "./ProtocolHttpClient.js";
import { loadDaemonSettings } from "../config/index.js";
import { waitForProcessExit } from "../processes/index.js";

const DAEMON_SHUTDOWN_TIMEOUT_MS = 10_000;

export interface LocalProtocolServerConnection {
    client: ProtocolHttpClient;
    paths: LocalServerPaths;
    token: string;
}

export interface EnsureLocalProtocolServerOptions {
    confirmRestart?: (request: DaemonRestartRequest) => Promise<boolean>;
    onStatus?: (message: string) => void;
}

export interface DaemonRestartRequest {
    currentIdentity: DaemonIdentity;
    runningIdentity: DaemonIdentity;
}

export async function ensureLocalProtocolServer(
    options: EnsureLocalProtocolServerOptions = {},
): Promise<LocalProtocolServerConnection> {
    const paths = getEnvironmentLocalServerPaths();
    const daemonSettings = await loadDaemonSettings();
    const currentIdentity = getDaemonIdentity();
    await prepareLocalServerDirectory(paths.directory);
    const existingToken = await readTokenIfPresent(paths.tokenPath);
    if (existingToken !== undefined) {
        const client = new ProtocolHttpClient({
            socketPath: paths.socketPath,
            token: existingToken,
        });
        const health = await readHealth(client);
        const identityMatches =
            health !== undefined && daemonIdentitiesMatch(currentIdentity, health.identity);
        if (identityMatches) {
            if (health.durableGlobalEventQueue === daemonSettings.durableGlobalEventQueue) {
                return { client, paths, token: existingToken };
            }
            const updated = await client.updateDaemonConfig({
                settings: {
                    durableGlobalEventQueue: daemonSettings.durableGlobalEventQueue,
                },
            });
            if (
                updated.config.settings.durableGlobalEventQueue !==
                daemonSettings.durableGlobalEventQueue
            ) {
                throw new Error("The local daemon did not apply the requested configuration.");
            }
            return { client, paths, token: existingToken };
        }
        if (health !== undefined) {
            if (!identityMatches) {
                const request: DaemonRestartRequest = {
                    currentIdentity,
                    runningIdentity: health.identity,
                };
                const shouldRestart = (await options.confirmRestart?.(request)) ?? false;
                if (!shouldRestart) {
                    throw new Error(
                        "The running daemon does not match this Rig CLI. Stop the running daemon, then try again.",
                    );
                }
            }
            options.onStatus?.("Restarting local daemon.");
            await stopIncompatibleDaemon(client, paths.registryPath);
        }
    }

    options.onStatus?.("Starting local daemon.");
    await removeStaleSocket(paths.socketPath);
    const token = await writeLocalServerToken(paths.tokenPath);
    await spawnLocalServer(paths);
    const client = new ProtocolHttpClient({ socketPath: paths.socketPath, token });
    await waitForReady(client);
    return { client, paths, token };
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

async function stopIncompatibleDaemon(
    client: ProtocolHttpClient,
    registryPath: string,
): Promise<void> {
    const registeredProcessId = await readLocalServerProcessId(registryPath);
    const response = await client.shutdown();
    const processId =
        response.pid !== undefined && Number.isSafeInteger(response.pid) && response.pid > 0
            ? response.pid
            : registeredProcessId;
    if (processId === undefined) {
        throw new Error(
            "Rig could not identify the running daemon process, so it did not start a replacement. Stop the daemon, then try again.",
        );
    }
    if (!(await waitForProcessExit(processId, DAEMON_SHUTDOWN_TIMEOUT_MS))) {
        throw new Error(
            "Timed out while waiting for the existing local daemon to stop. Rig did not start a replacement.",
        );
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

async function waitForReady(client: ProtocolHttpClient): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        try {
            await client.health();
            return;
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
