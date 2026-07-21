import { chmod, open } from "node:fs/promises";
import { createServer } from "node:http";

import { createProtocolHttpServer } from "./createProtocolHttpServer.js";
import { configureSessionRequest } from "./configureSessionRequest.js";
import {
    createDaemonStartupRequestListener,
    type DaemonStartupState,
} from "./createDaemonStartupRequestListener.js";
import { createModelCatalog } from "./createModelCatalog.js";
import { getEnvironmentLocalServerPaths } from "./getEnvironmentLocalServerPaths.js";
import { loadHappyIntegration, type HappyIntegrationMode } from "./loadHappyIntegration.js";
import { prepareLocalServerDirectory } from "./prepareLocalServerDirectory.js";
import { PersistentSessionStore } from "./PersistentSessionStore.js";
import { TrackedTaskDrain } from "./TrackedTaskDrain.js";
import { readLocalServerToken } from "./readLocalServerToken.js";
import { removeStaleSocket } from "./removeStaleSocket.js";
import { resolveHappyIntegrationMode } from "./resolveHappyIntegrationMode.js";
import { McpClientManager } from "../mcp/index.js";
import { loadConfig, writeDaemonSettings } from "../config/index.js";
import { createProviderQuotaService } from "../providers/createProviderQuotaService.js";
import { disableUnavailableProviders } from "../providers/disableUnavailableProviders.js";
import { resolveProviderDisabledReasons } from "../providers/resolveProviderDisabledReasons.js";
import { createCodingAssistantAgent } from "../runtime/createCodingAssistantAgent.js";
import { getDaemonIdentity } from "../daemon/index.js";
import { errorToMessage } from "../errorToMessage.js";
import { getNodeInspectorUrl, openNodeInspector, registerRigDebugRoot } from "../debug/index.js";
import type { HappySyncService } from "../happy/index.js";

export interface RunLocalProtocolServerOptions {
    happyIntegration?: HappyIntegrationMode;
    socketPath?: string;
    tokenPath?: string;
}

export async function runLocalProtocolServer(
    options: RunLocalProtocolServerOptions = {},
): Promise<void> {
    const paths = getEnvironmentLocalServerPaths();
    const socketPath = options.socketPath ?? paths.socketPath;
    const tokenPath = options.tokenPath ?? paths.tokenPath;
    const startedAt = new Date().toISOString();
    await prepareLocalServerDirectory(paths.directory);
    const token = await readLocalServerToken(tokenPath);
    await removeStaleSocket(socketPath);

    let startupState: DaemonStartupState = { status: "starting" };
    let mcpToolProvider: McpClientManager | undefined;
    let happySyncService: HappySyncService | undefined;
    let happyLifecycle = Promise.resolve();
    let store: PersistentSessionStore | undefined;
    let taskDrain: TrackedTaskDrain | undefined;
    let stopping = false;
    let resolveStopped: (() => void) | undefined;
    const stopped = new Promise<void>((resolve) => {
        resolveStopped = resolve;
    });
    const runHappyLifecycle = <T>(operation: () => Promise<T>): Promise<T> => {
        const next = happyLifecycle.then(operation, operation);
        happyLifecycle = next.then(
            () => undefined,
            () => undefined,
        );
        return next;
    };
    const stopServer = () => {
        if (stopping) return;
        stopping = true;
        taskDrain?.beginClose();
        const serverClosed = new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
        void (async () => {
            if (store !== undefined) {
                try {
                    await store.prepareForShutdown("shutdown");
                } catch (error) {
                    console.error(
                        error instanceof Error
                            ? error.message
                            : `Failed to drain interrupted sessions: ${String(error)}`,
                    );
                }
            }
            server.closeAllConnections();
            await serverClosed;
            resolveStopped?.();
        })();
    };
    const startupRequestListener = createDaemonStartupRequestListener({
        getState: () => startupState,
        identity: getDaemonIdentity(),
        onShutdown: stopServer,
        token,
    });
    const server = createServer(startupRequestListener);
    const writeServerRegistry = () => {
        const inspectorUrl = getNodeInspectorUrl();
        return writeRegistry(paths.registryPath, {
            ...(inspectorUrl === undefined ? {} : { inspectorUrl }),
            pid: process.pid,
            socketPath,
            startedAt,
        });
    };
    let initialization = Promise.resolve();
    const reportStartupError = (error: unknown) => {
        if (stopping) return;
        const message = errorToMessage(error);
        startupState = { error: message, status: "error" };
        console.error(`Daemon startup failed: ${message}`);
    };
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
        process.once("SIGINT", stopServer);
        process.once("SIGTERM", stopServer);
        try {
            await chmod(socketPath, 0o600);
            if (stopping) {
                await stopped;
                return;
            }
            await writeServerRegistry();
        } catch (error) {
            reportStartupError(error);
            await stopped;
            return;
        }
        if (stopping) {
            await stopped;
            return;
        }

        initialization = initializeDaemon().catch(reportStartupError);

        await stopped;
        await initialization;
    } finally {
        process.off("SIGINT", stopServer);
        process.off("SIGTERM", stopServer);
        await initialization;
        if (mcpToolProvider !== undefined) {
            try {
                await mcpToolProvider.close();
            } catch (error) {
                console.error(
                    error instanceof Error
                        ? `Failed to close MCP connections: ${error.message}`
                        : `Failed to close MCP connections: ${String(error)}`,
                );
            }
        }
        try {
            await runHappyLifecycle(async () => {
                const service = happySyncService;
                happySyncService = undefined;
                await service?.close();
            });
        } catch (error) {
            console.error(`Failed to close Happy sync: ${errorToMessage(error)}`);
        }
        store?.close();
    }

    async function initializeDaemon(): Promise<void> {
        const loadedConfig = await loadConfig({ cwd: process.cwd() });
        if (stopping) return;

        const providerQuotaService = createProviderQuotaService({
            cwd: process.cwd(),
            providers: loadedConfig.config.providers,
        });
        const disabledProviderReasons = await resolveProviderDisabledReasons(
            loadedConfig.config.providers,
            process.env,
        );
        if (stopping) return;
        const availableProviders = disableUnavailableProviders(
            loadedConfig.config.providers,
            disabledProviderReasons,
        );
        const modelCatalog = createModelCatalog({
            cwd: process.cwd(),
            disabledProviderReasons,
            providers: loadedConfig.config.providers,
        });
        mcpToolProvider = new McpClientManager();
        taskDrain = new TrackedTaskDrain();
        const happyModule = await loadHappyIntegration(
            resolveHappyIntegrationMode(
                options.happyIntegration,
                loadedConfig.config.settings.happyIntegration,
            ),
        );
        const happyConfiguration = await happyModule?.importHappyCredentials({
            machineScope: socketPath,
        });
        store = new PersistentSessionStore({
            createRuntime: (options) =>
                createCodingAssistantAgent({
                    ...options,
                    providers: availableProviders,
                }),
            databasePath: paths.databasePath,
            durableGlobalEventQueue: loadedConfig.config.settings.durableGlobalEventQueue,
            mcpToolProvider,
            modelCatalog,
            ...(happyModule === undefined
                ? {}
                : {
                      onSessionAccess: (session) => happySyncService?.attach(session),
                      onSessionEvent: (event, session) => happySyncService?.observe(event, session),
                  }),
            taskDrain,
        });
        if (happyModule !== undefined && happyConfiguration !== undefined) {
            try {
                const service = new happyModule.HappySyncService({
                    configuration: happyConfiguration,
                    createSession: (id, request) =>
                        store!.createWithId(
                            id,
                            configureSessionRequest(request, loadedConfig.config.docker),
                        ),
                    databasePath: paths.databasePath,
                    getSubagents: (sessionId) => store?.listSubagents(sessionId) ?? [],
                    modelCatalog,
                });
                service.start();
                happySyncService = service;
            } catch (error) {
                console.error(`Happy sync is unavailable: ${errorToMessage(error)}`);
            }
        }
        registerRigDebugRoot({
            kind: "daemon",
            paths,
            server,
            store,
        });
        if (stopping) {
            taskDrain.beginClose();
            return;
        }

        createProtocolHttpServer(
            {
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
                    return store?.setDurableGlobalEventQueue(enabled);
                },
                ...(happyModule === undefined
                    ? {}
                    : {
                          onReloadHappy: async () => {
                              if (stopping) return false;
                              return runHappyLifecycle(async () => {
                                  if (stopping) return false;
                                  const nextConfiguration =
                                      await happyModule.importHappyCredentials({
                                          machineScope: socketPath,
                                      });
                                  if (stopping || nextConfiguration === undefined) return false;
                                  let next: HappySyncService;
                                  try {
                                      next = new happyModule.HappySyncService({
                                          configuration: nextConfiguration,
                                          createSession: (id, request) =>
                                              store!.createWithId(
                                                  id,
                                                  configureSessionRequest(
                                                      request,
                                                      loadedConfig.config.docker,
                                                  ),
                                              ),
                                          databasePath: paths.databasePath,
                                          getSubagents: (sessionId) =>
                                              store?.listSubagents(sessionId) ?? [],
                                          modelCatalog,
                                      });
                                  } catch (error) {
                                      console.error(
                                          `Happy sync could not reload: ${errorToMessage(error)}`,
                                      );
                                      return false;
                                  }
                                  const previous = happySyncService;
                                  happySyncService = undefined;
                                  try {
                                      await previous?.close();
                                  } catch (error) {
                                      console.error(
                                          `The previous Happy sync connection could not close cleanly: ${errorToMessage(error)}`,
                                      );
                                  }
                                  next.start();
                                  happySyncService = next;
                                  for (const session of store!.loadedSessions()) {
                                      next.attach(session);
                                  }
                                  return true;
                              });
                          },
                      }),
                onStartInspector: async () => {
                    const inspectorUrl = openNodeInspector();
                    await writeServerRegistry();
                    return { inspectorUrl };
                },
                onShutdown: stopServer,
                store,
                taskDrain,
                token,
            },
            server,
        );
        server.off("request", startupRequestListener);
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
