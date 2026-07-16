import { chmod, open } from "node:fs/promises";

import { createProtocolHttpServer } from "./createProtocolHttpServer.js";
import { createModelCatalog } from "./createModelCatalog.js";
import { getEnvironmentLocalServerPaths } from "./getEnvironmentLocalServerPaths.js";
import { prepareLocalServerDirectory } from "./prepareLocalServerDirectory.js";
import { PersistentSessionStore } from "./PersistentSessionStore.js";
import { TrackedTaskDrain } from "./TrackedTaskDrain.js";
import { readLocalServerToken } from "./readLocalServerToken.js";
import { removeStaleSocket } from "./removeStaleSocket.js";
import { McpClientManager } from "../mcp/index.js";
import { loadConfig, writeDaemonSettings } from "../config/index.js";
import { createProviderQuotaService } from "../providers/createProviderQuotaService.js";
import { createCodingAssistantAgent } from "../runtime/createCodingAssistantAgent.js";

export interface RunLocalProtocolServerOptions {
    socketPath?: string;
    tokenPath?: string;
}

export async function runLocalProtocolServer(
    options: RunLocalProtocolServerOptions = {},
): Promise<void> {
    const paths = getEnvironmentLocalServerPaths();
    const socketPath = options.socketPath ?? paths.socketPath;
    const tokenPath = options.tokenPath ?? paths.tokenPath;
    await prepareLocalServerDirectory(paths.directory);
    const token = await readLocalServerToken(tokenPath);
    await removeStaleSocket(socketPath);

    const loadedConfig = await loadConfig({ cwd: process.cwd() });
    const providerQuotaService = createProviderQuotaService({ cwd: process.cwd() });
    const modelCatalog = createModelCatalog({
        cwd: process.cwd(),
        providers: loadedConfig.config.providers,
    });
    const mcpToolProvider = new McpClientManager();
    const taskDrain = new TrackedTaskDrain();
    const store = new PersistentSessionStore({
        createRuntime: (options) =>
            createCodingAssistantAgent({
                ...options,
                providers: loadedConfig.config.providers,
            }),
        databasePath: paths.databasePath,
        durableGlobalEventQueue: loadedConfig.config.settings.durableGlobalEventQueue,
        mcpToolProvider,
        modelCatalog,
        taskDrain,
    });
    let stopServer: (() => void) | undefined;
    const server = createProtocolHttpServer({
        ...(loadedConfig.config.docker === undefined
            ? {}
            : { defaultDocker: loadedConfig.config.docker }),
        ...(store.globalEventQueue === undefined
            ? {}
            : { globalEventQueue: store.globalEventQueue }),
        modelCatalog,
        getProviderQuota: (providerId) => providerQuotaService.get(providerId),
        onDurableGlobalEventQueueChange: async (enabled) => {
            await writeDaemonSettings({ durableGlobalEventQueue: enabled });
            return store.setDurableGlobalEventQueue(enabled);
        },
        onShutdown: () => stopServer?.(),
        store,
        taskDrain,
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
                taskDrain.beginClose();
                const serverClosed = new Promise<void>((resolveClose) => {
                    server.close(() => resolveClose());
                });
                void (async () => {
                    try {
                        await store.prepareForShutdown("shutdown");
                    } catch (error) {
                        console.error(
                            error instanceof Error
                                ? error.message
                                : `Failed to drain interrupted sessions: ${String(error)}`,
                        );
                    }
                    server.closeAllConnections();
                    await serverClosed;
                    resolve();
                })();
            };
            process.once("SIGINT", stopServer);
            process.once("SIGTERM", stopServer);
        });
    } finally {
        stopServer = undefined;
        try {
            await mcpToolProvider.close();
        } catch (error) {
            console.error(
                error instanceof Error
                    ? `Failed to close MCP connections: ${error.message}`
                    : `Failed to close MCP connections: ${String(error)}`,
            );
        } finally {
            store.close();
        }
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
