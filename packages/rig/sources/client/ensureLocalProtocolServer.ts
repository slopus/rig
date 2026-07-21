import { spawn } from "node:child_process";
import { open } from "node:fs/promises";

import {
    getEnvironmentLocalServerPaths,
    prepareLocalServerDirectory,
    readLocalServerToken,
    removeStaleSocket,
    runLocalProtocolServer,
    writeLocalServerToken,
    type LocalServerPaths,
} from "../server/index.js";
import { daemonIdentitiesMatch, getDaemonIdentity } from "../daemon/index.js";
import type { DaemonIdentity, ReadyHealthResponse } from "../protocol/index.js";
import { ProtocolHttpClient } from "./ProtocolHttpClient.js";
import { loadDaemonSettings } from "../config/index.js";
import { stopLocalProtocolServer } from "./stopLocalProtocolServer.js";

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
            const readyHealth = await resolveReadyHealth(client, health);
            await reconcileDaemonSettings(client, readyHealth);
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
            await stopLocalProtocolServer(client, paths.registryPath);
        }
    }

    options.onStatus?.("Starting local daemon.");
    await removeStaleSocket(paths.socketPath);
    const token = await writeLocalServerToken(paths.tokenPath);
    if (process.env.RIG_GYM_IN_PROCESS_DAEMON === "1") {
        void runLocalProtocolServer({
            happyIntegration: "enabled",
            socketPath: paths.socketPath,
            tokenPath: paths.tokenPath,
        }).catch((error: unknown) => {
            options.onStatus?.(
                `Local daemon stopped: ${error instanceof Error ? error.message : String(error)}`,
            );
        });
    } else {
        await spawnLocalServer(paths);
    }
    const client = new ProtocolHttpClient({ socketPath: paths.socketPath, token });
    const health = await waitForReady(client);
    await reconcileDaemonSettings(client, health);
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

async function waitForReady(client: ProtocolHttpClient): Promise<ReadyHealthResponse> {
    let deadline = Date.now() + 5_000;
    let observedStarting = false;
    while (Date.now() < deadline) {
        let health: Awaited<ReturnType<ProtocolHttpClient["health"]>>;
        try {
            health = await client.health();
        } catch {
            // The socket may not be accepting connections yet.
            await delay(50);
            continue;
        }
        if (health.status === "ready") return health;
        if (health.status === "error") throw daemonStartupError(health.error);
        observedStarting = true;
        deadline = Date.now() + 5_000;
        await delay(50);
    }

    if (observedStarting) {
        throw new Error("The local daemon stopped responding while it was starting.");
    }
    throw new Error("Timed out while waiting for the local Rig server.");
}

async function resolveReadyHealth(
    client: ProtocolHttpClient,
    health: Awaited<ReturnType<ProtocolHttpClient["health"]>>,
): Promise<ReadyHealthResponse> {
    if (health.status === "error") throw daemonStartupError(health.error);
    if (health.status === "ready") return health;
    return waitForReady(client);
}

async function reconcileDaemonSettings(
    client: ProtocolHttpClient,
    health: ReadyHealthResponse,
): Promise<void> {
    const daemonSettings = await loadDaemonSettings();
    if (health.durableGlobalEventQueue === daemonSettings.durableGlobalEventQueue) return;

    const updated = await client.updateDaemonConfig({
        settings: {
            durableGlobalEventQueue: daemonSettings.durableGlobalEventQueue,
        },
    });
    if (
        updated.config.settings.durableGlobalEventQueue !== daemonSettings.durableGlobalEventQueue
    ) {
        throw new Error("The local daemon did not apply the requested configuration.");
    }
}

function daemonStartupError(message: string): Error {
    return new Error(`Daemon could not start: ${message}`);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
