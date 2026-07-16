import { basename } from "node:path";

import { createNodeAgentContext } from "../agent/index.js";
import { ensureLocalProtocolServer, RemoteAgent } from "../client/index.js";
import {
    createProjectConfigSecurityNotice,
    createProjectConfigSecurityNoticeTitle,
    loadConfig,
    writeRuntimeConfig,
} from "../config/index.js";
import { createProjectMcpSecurityNotice, loadMcpServerConfigEntries } from "../mcp/index.js";
import { NativeProxessManager } from "../processes/index.js";
import type { PermissionMode } from "../permissions/index.js";
import type { SessionEvent } from "../protocol/index.js";
import { resolveDockerExecutionConfig } from "../execution/index.js";
import type { DockerExecutionConfig } from "../execution/index.js";
import { CodingAssistantApp } from "./CodingAssistantApp.js";
import { type CreateCodingAssistantAgentOptions } from "../runtime/createCodingAssistantAgent.js";
import { createSerialTaskQueue } from "./createSerialTaskQueue.js";
import { createStopOnceHandler } from "./createStopOnceHandler.js";
import { createStartupStatusCardModel } from "./createStartupStatusCardModel.js";
import { ensureSessionCanResume } from "./ensureSessionCanResume.js";
import { providerQuotaToStartupStatusUsage } from "./providerQuotaToStartupStatusUsage.js";
import { readPackageVersion } from "../readPackageVersion.js";
import { resolveTerminalTheme } from "./resolveTerminalTheme.js";
import { resolveStartupProviderQuota } from "./resolveStartupProviderQuota.js";
import { ScrollbackPreservingTerminal } from "./ScrollbackPreservingTerminal.js";
import { ScrollbackPreservingTUI } from "./ScrollbackPreservingTUI.js";
import { sessionAgentFooterLabel } from "./sessionAgentFooterLabel.js";
import { StartupStatusApp } from "./StartupStatusApp.js";
import { getDebugRootDirectory } from "../debug/index.js";

export interface RunAppOptions {
    apiKey?: string;
    cwd?: string;
    debug?: boolean;
    effort?: string;
    instructions?: string;
    modelId?: string;
    providerId?: string;
    permissionMode?: PermissionMode;
    resumeSessionId?: string;
    showReasoning?: boolean;
    showUsage?: boolean;
    docker?: DockerExecutionConfig | null;
}

export async function runApp(options: RunAppOptions = {}): Promise<void> {
    const cwd = options.cwd ?? process.cwd();
    const [loadedConfig, mcpConfigEntries] = await Promise.all([
        loadConfig({ cwd }),
        loadMcpServerConfigEntries(cwd),
    ]);
    const projectConfigNotice = createProjectConfigSecurityNotice(
        loadedConfig.sources.local.values,
    );
    const projectMcpNotice = createProjectMcpSecurityNotice(mcpConfigEntries);
    const agentOptions: CreateCodingAssistantAgentOptions = {
        cwd,
        modelId: loadedConfig.config.defaults.modelId,
        permissionMode: loadedConfig.config.defaults.permissionMode,
        workflowsEnabled: loadedConfig.config.features.workflows,
    };
    if (loadedConfig.config.defaults.providerId !== undefined) {
        agentOptions.providerId = loadedConfig.config.defaults.providerId;
    }
    if (loadedConfig.config.defaults.effort !== undefined) {
        agentOptions.effort = loadedConfig.config.defaults.effort;
    }
    if (loadedConfig.config.defaults.serviceTier !== undefined) {
        agentOptions.serviceTier = loadedConfig.config.defaults.serviceTier;
    }
    if (loadedConfig.config.defaults.instructions !== undefined) {
        agentOptions.instructions = loadedConfig.config.defaults.instructions;
    }
    if (loadedConfig.config.docker !== undefined) {
        agentOptions.docker = resolveDockerExecutionConfig(loadedConfig.config.docker, cwd);
    }
    if (options.docker === null) {
        delete agentOptions.docker;
        agentOptions.local = true;
    } else if (options.docker !== undefined) {
        agentOptions.docker = resolveDockerExecutionConfig(options.docker, cwd);
    }
    if (options.apiKey !== undefined) agentOptions.apiKey = options.apiKey;
    if (options.effort !== undefined) agentOptions.effort = options.effort;
    if (options.instructions !== undefined) agentOptions.instructions = options.instructions;
    if (options.modelId !== undefined) agentOptions.modelId = options.modelId;
    if (options.providerId !== undefined) agentOptions.providerId = options.providerId;
    if (options.permissionMode !== undefined) agentOptions.permissionMode = options.permissionMode;
    let completionChime = loadedConfig.config.settings.completionChime;
    let durableGlobalEventQueue = loadedConfig.config.settings.durableGlobalEventQueue;
    let showReasoning = options.showReasoning ?? loadedConfig.config.settings.showReasoning;
    let showUsage = options.showUsage ?? loadedConfig.config.settings.showUsage;
    const enqueueRuntimeConfigWrite = createSerialTaskQueue();
    const startupTheme = resolveTerminalTheme(loadedConfig.config.theme);
    const runtimeTheme = loadedConfig.sources.runtime.values.theme;

    // Keep the terminal in TUI mode while the daemon starts so startup work is visible.
    const terminal = new ScrollbackPreservingTerminal();
    terminal.setTitle(`Rig - ${sanitizeTerminalTitle(basename(cwd))}`);
    const tui = new ScrollbackPreservingTUI(terminal, false);
    const startup = new StartupStatusApp({
        cwd,
        theme: startupTheme,
        tui,
        version: readPackageVersion(),
    });
    startup.start();
    tui.setTerminalColorSchemeNotifications(true);
    terminal.write("\x1b[?1004h");
    const terminalBackground = tui.queryTerminalBackgroundColor({ timeoutMs: 250 });

    const { history, localServer, modelCatalog, session } = await (async () => {
        try {
            const connection = await ensureLocalProtocolServer({
                confirmRestart: (request) => startup.confirmDaemonRestart(request),
                onStatus: (message) => {
                    startup.setStatus(message);
                },
            });
            startup.setStatus("Opening session.");
            const [openedSession, modelsResponse] = await Promise.all([
                options.resumeSessionId === undefined
                    ? connection.client.createSession(agentOptions)
                    : connection.client.getSession(options.resumeSessionId),
                connection.client.models(),
            ]);
            if (options.resumeSessionId !== undefined) {
                ensureSessionCanResume(openedSession.session);
            }
            startup.setStatus("Loading transcript.");
            const loadedHistory =
                options.resumeSessionId === undefined
                    ? { events: [] as SessionEvent[] }
                    : await connection.client.getEvents(openedSession.session.id);

            return {
                history: loadedHistory,
                localServer: connection,
                modelCatalog: modelsResponse.catalog,
                session: openedSession,
            };
        } catch (error) {
            startup.stop();
            terminal.write("\x1b[?1004l");
            tui.stop();
            throw error;
        }
    })();
    const processManager = new NativeProxessManager();
    const theme = resolveTerminalTheme(loadedConfig.config.theme, await terminalBackground);
    const sessionCwd = session.session.cwd;
    if (session.session.title !== undefined) {
        terminal.setTitle(`Rig - ${sanitizeTerminalTitle(session.session.title)}`);
    }
    const [subagents, currentProviderQuotaResponse] = await Promise.all([
        localServer.client.listSubagents(session.session.id),
        resolveStartupProviderQuota(() =>
            localServer.client.getCurrentProviderQuota(session.session.id),
        ),
    ]).catch((error: unknown) => {
        startup.stop();
        terminal.write("\x1b[?1004l");
        tui.stop();
        throw error;
    });
    const context = createNodeAgentContext({
        cwd: sessionCwd,
        permissionMode: session.session.permissionMode,
        processManager,
    });
    const agent = new RemoteAgent({
        client: localServer.client,
        context,
        debug: options.debug === true,
        modelCatalog,
        session: session.session,
    });
    const resumeCommand = `rig resume ${session.session.id}`;
    const version = readPackageVersion();
    const activeAgentLabel = sessionAgentFooterLabel(session.session.agent);
    const startupUsage = providerQuotaToStartupStatusUsage(
        currentProviderQuotaResponse?.currentProviderId === session.session.providerId
            ? currentProviderQuotaResponse.quota
            : undefined,
    );
    const initialNotices = [
        ...(options.debug === true
            ? [
                  {
                      text: `Each request will write private JSON records to ${getDebugRootDirectory(sessionCwd)}. These files include prompts, model responses, tool arguments, and tool results.`,
                      title: "Debug logging enabled",
                  },
              ]
            : []),
        ...(projectConfigNotice === undefined
            ? []
            : [
                  {
                      text: projectConfigNotice,
                      title: createProjectConfigSecurityNoticeTitle(
                          loadedConfig.sources.local.values,
                      ),
                  },
              ]),
        ...(projectMcpNotice === undefined
            ? []
            : [{ text: projectMcpNotice, title: "Project MCP needs trust" }]),
    ];
    const app = new CodingAssistantApp({
        ...(activeAgentLabel === undefined ? {} : { activeAgentLabel }),
        agent,
        attachSecret: (id, scope) => agent.attachSecret(id, scope),
        cwd: sessionCwd,
        detachSecret: (id, scope) => agent.detachSecret(id, scope),
        initialSessionEvents: history.events,
        initialBackgroundProcesses: session.session.backgroundProcesses ?? [],
        initialMcpServers: session.session.mcpServers,
        ...(initialNotices.length === 0 ? {} : { initialNotices }),
        initialSubagents: subagents.subagents,
        initialProjectSecretIds: session.session.projectSecretIds,
        initialSessionSecretIds: session.session.sessionSecretIds,
        initialUserInputs: session.session.pendingUserInputs,
        initialTasks: session.session.tasks,
        ...(session.session.lastEventId === undefined
            ? {}
            : { initialWorkflowEventId: session.session.lastEventId }),
        initialWorkflows: session.session.workflows ?? [],
        workflowsEnabled: session.session.workflowsEnabled !== false,
        modelLocked: session.session.modelLocked,
        listSecrets: () => localServer.client.listSecrets().then((response) => response.secrets),
        onDefaultModelChange: (preference) =>
            enqueueRuntimeConfigWrite(() =>
                writeRuntimeConfig(loadedConfig.paths.runtime, {
                    defaults: {
                        modelId: preference.modelId,
                        providerId: preference.providerId,
                        effort: preference.effort,
                        permissionMode: agent.permissionMode,
                        serviceTier: preference.serviceTier,
                    },
                    settings: {
                        completionChime,
                        durableGlobalEventQueue,
                        showReasoning,
                        showUsage,
                    },
                    ...(runtimeTheme === undefined ? {} : { theme: runtimeTheme }),
                }),
            ),
        onSettingsChange: async (settings) => {
            completionChime = settings.completionChime;
            durableGlobalEventQueue = settings.durableGlobalEventQueue;
            showReasoning = settings.showReasoning;
            showUsage = settings.showUsage;
            await enqueueRuntimeConfigWrite(() =>
                writeRuntimeConfig(loadedConfig.paths.runtime, {
                    defaults: {
                        modelId: agent.model.id,
                        providerId: agent.provider.id,
                        effort: agent.snapshot().effort ?? agent.model.defaultThinkingLevel,
                        permissionMode: agent.permissionMode,
                        serviceTier: agent.confirmedServiceTier ?? null,
                    },
                    settings,
                    ...(runtimeTheme === undefined ? {} : { theme: runtimeTheme }),
                }),
            );
            await localServer.client.updateDaemonConfig({
                settings: { durableGlobalEventQueue },
            });
        },
        onUserActivity: () => {
            void localServer.client.recordSessionActivity(session.session.id).catch(() => {});
        },
        onStopWorkflow: (runId) =>
            localServer.client.stopWorkflow(session.session.id, runId).then(() => undefined),
        processManager,
        registerSecret: (registration) =>
            localServer.client.registerSecret(registration).then((response) => response.secret),
        respondUserInput: (requestId, response) =>
            localServer.client
                .answerUserInput(session.session.id, requestId, response)
                .then(() => undefined),
        searchFiles: (query) =>
            localServer.client
                .searchFiles(session.session.id, query)
                .then((response) => response.files),
        sessionBacked: true,
        completionChime,
        durableGlobalEventQueue,
        showReasoning,
        showUsage,
        startupStatus: createStartupStatusCardModel({
            model: agent.model,
            resumed: options.resumeSessionId !== undefined,
            session: session.session,
            ...(startupUsage === undefined ? {} : { usage: startupUsage }),
            version,
        }),
        theme,
        tui,
        unregisterSecret: (id) =>
            localServer.client.unregisterSecret(id).then((response) => response.removed),
        version,
    });
    let terminalThemeRefresh = 0;
    const stopWatchingTerminalTheme = tui.onTerminalColorSchemeChange((colorScheme) => {
        const refresh = ++terminalThemeRefresh;
        void tui.queryTerminalBackgroundColor({ timeoutMs: 250 }).then((background) => {
            if (refresh !== terminalThemeRefresh) return;
            app.setTheme(
                resolveTerminalTheme(
                    loadedConfig.config.theme,
                    background ??
                        (colorScheme === "light"
                            ? { r: 0xff, g: 0xff, b: 0xff }
                            : { r: 0x0d, g: 0x0d, b: 0x0d }),
                ),
            );
        });
    });
    startup.stop();
    const followController = new AbortController();
    const observedSettlementEvents = new Set<string>();
    const lastHistoryEventId = history.events.at(-1)?.id ?? session.session.lastEventId;
    void localServer.client.watchSessionEvents({
        ...(lastHistoryEventId !== undefined ? { after: lastHistoryEventId } : {}),
        onEvent: (event) => {
            if (event.type === "session_title_changed" && event.data.title !== undefined) {
                terminal.setTitle(`Rig - ${sanitizeTerminalTitle(event.data.title)}`);
            }
            const isNewSettlement =
                event.type === "session_title_changed" &&
                event.data.status === "ready" &&
                event.data.metadataUpdatedAt !== undefined &&
                !observedSettlementEvents.has(event.id);
            if (isNewSettlement) {
                observedSettlementEvents.add(event.id);
                if (completionChime) terminal.write("\x07");
            }
            agent.applySessionEvent(event);
            app.applySessionEvent(event);
        },
        sessionId: session.session.id,
        signal: followController.signal,
    });

    const requestStop = createStopOnceHandler(
        () => app.stop(),
        (error) => {
            console.error(error);
            process.exitCode = 1;
        },
    );
    const stop = () => {
        void requestStop();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    try {
        app.start({ tuiAlreadyStarted: true });
        await app.waitForExit();
    } finally {
        stopWatchingTerminalTheme();
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        followController.abort();
        terminal.write("\x1b[?1004l");
        await processManager.killAll({ forceAfterMs: 500 });
        console.error("");
        console.error(`Session: ${session.session.id}`);
        console.error(`Resume: ${resumeCommand}`);
    }
}

function sanitizeTerminalTitle(value: string): string {
    return [...value]
        .filter((character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint > 31 && codePoint !== 127;
        })
        .join("");
}
