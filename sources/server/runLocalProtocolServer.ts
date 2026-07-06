import { chmod, open } from "node:fs/promises";

import { createProtocolHttpServer } from "./createProtocolHttpServer.js";
import { createModelCatalog } from "./createModelCatalog.js";
import { getLocalServerPaths } from "./LocalServerPaths.js";
import { prepareLocalServerDirectory } from "./prepareLocalServerDirectory.js";
import { PersistentSessionStore } from "./PersistentSessionStore.js";
import { readLocalServerToken } from "./readLocalServerToken.js";
import { removeStaleSocket } from "./removeStaleSocket.js";

export interface RunLocalProtocolServerOptions {
    socketPath?: string;
    tokenPath?: string;
}

export async function runLocalProtocolServer(
    options: RunLocalProtocolServerOptions = {},
): Promise<void> {
    const paths = getLocalServerPaths();
    const socketPath = options.socketPath ?? paths.socketPath;
    const tokenPath = options.tokenPath ?? paths.tokenPath;
    await prepareLocalServerDirectory(paths.directory);
    const token = await readLocalServerToken(tokenPath);
    await removeStaleSocket(socketPath);

    const modelCatalog = createModelCatalog({ cwd: process.cwd() });
    const store = new PersistentSessionStore({ databasePath: paths.databasePath, modelCatalog });
    let stopServer: (() => void) | undefined;
    const server = createProtocolHttpServer({
        modelCatalog,
        onShutdown: () => stopServer?.(),
        store,
        token,
    });
    try {
        const previousUmask = process.umask(0o077);
        try {
            await new Promise<void>((resolve, reject) => {
                server.once("error", reject);
                server.listen(socketPath, () => {
                    server.off("error", reject);
                    resolve();
                });
            });
        } finally {
            process.umask(previousUmask);
        }
        await chmod(socketPath, 0o600);
        await writeRegistry(paths.registryPath, {
            pid: process.pid,
            socketPath,
            startedAt: new Date().toISOString(),
        });

        await new Promise<void>((resolve) => {
            let stopping = false;
            stopServer = () => {
                if (stopping) {
                    return;
                }
                stopping = true;
                try {
                    store.repairInterruptedSessions("shutdown");
                } catch (error) {
                    console.error(
                        error instanceof Error
                            ? error.message
                            : `Failed to repair interrupted sessions: ${String(error)}`,
                    );
                } finally {
                    server.close(() => resolve());
                }
            };
            process.once("SIGINT", stopServer);
            process.once("SIGTERM", stopServer);
        });
    } finally {
        stopServer = undefined;
        store.close();
    }
}

async function writeRegistry(path: string, payload: unknown): Promise<void> {
    const file = await open(path, "w", 0o600);
    try {
        await file.writeFile(`${JSON.stringify(payload, null, 2)}\n`);
        await file.chmod(0o600);
    } finally {
        await file.close();
    }
}
