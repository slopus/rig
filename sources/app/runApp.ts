import { ProcessTerminal, TUI } from "@earendil-works/pi-tui";

import { createNodeAgentContext } from "../agent/index.js";
import { ensureLocalProtocolServer, RemoteAgent } from "../client/index.js";
import { loadConfig, writeRuntimeConfig } from "../config/index.js";
import { NativeProxessManager } from "../processes/index.js";
import type { SessionEvent } from "../protocol/index.js";
import { CodingAssistantApp } from "./CodingAssistantApp.js";
import { type CreateCodingAssistantAgentOptions } from "./createCodingAssistantAgent.js";
import { createStopOnceHandler } from "./createStopOnceHandler.js";
import { ensureSessionCanResume } from "./ensureSessionCanResume.js";
import { readPackageVersion } from "./readPackageVersion.js";
import { StartupStatusApp } from "./StartupStatusApp.js";

export interface RunAppOptions {
    apiKey?: string;
    cwd?: string;
    effort?: string;
    instructions?: string;
    modelId?: string;
    providerId?: string;
    resumeSessionId?: string;
    showReasoning?: boolean;
}

export async function runApp(options: RunAppOptions = {}): Promise<void> {
    const cwd = options.cwd ?? process.cwd();
    const loadedConfig = await loadConfig({ cwd });
    const agentOptions: CreateCodingAssistantAgentOptions = {
        cwd,
        modelId: loadedConfig.config.defaults.modelId,
    };
    if (loadedConfig.config.defaults.providerId !== undefined) {
        agentOptions.providerId = loadedConfig.config.defaults.providerId;
    }
    if (loadedConfig.config.defaults.effort !== undefined) {
        agentOptions.effort = loadedConfig.config.defaults.effort;
    }
    if (loadedConfig.config.defaults.instructions !== undefined) {
        agentOptions.instructions = loadedConfig.config.defaults.instructions;
    }
    if (options.apiKey !== undefined) agentOptions.apiKey = options.apiKey;
    if (options.effort !== undefined) agentOptions.effort = options.effort;
    if (options.instructions !== undefined) agentOptions.instructions = options.instructions;
    if (options.modelId !== undefined) agentOptions.modelId = options.modelId;
    if (options.providerId !== undefined) agentOptions.providerId = options.providerId;
    let showReasoning = options.showReasoning ?? loadedConfig.config.settings.showReasoning;

    // Keep the terminal in TUI mode while the daemon starts so startup work is visible.
    const tui = new TUI(new ProcessTerminal(), false);
    const startup = new StartupStatusApp({
        cwd,
        tui,
        version: readPackageVersion(),
    });
    startup.start();

    const { history, localServer, modelCatalog, session } = await (async () => {
        try {
            const connection = await ensureLocalProtocolServer({
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
            tui.stop();
            throw error;
        }
    })();
    const processManager = new NativeProxessManager();
    const sessionCwd = session.session.cwd;
    const context = createNodeAgentContext({ cwd: sessionCwd, processManager });
    const agent = new RemoteAgent({
        client: localServer.client,
        context,
        modelCatalog,
        session: session.session,
    });
    const resumeCommand = `rig resume ${session.session.id}`;
    const app = new CodingAssistantApp({
        agent,
        cwd: sessionCwd,
        initialSessionEvents: history.events,
        modelLocked: session.session.modelLocked,
        onDefaultModelChange: (preference) =>
            writeRuntimeConfig(loadedConfig.paths.runtime, {
                defaults: {
                    modelId: preference.modelId,
                    providerId: preference.providerId,
                    effort: preference.effort,
                },
                settings: {
                    showReasoning,
                },
            }),
        onSettingsChange: (settings) => {
            showReasoning = settings.showReasoning;
            return writeRuntimeConfig(loadedConfig.paths.runtime, {
                defaults: {
                    modelId: agent.model.id,
                    providerId: agent.provider.id,
                    effort: agent.snapshot().effort ?? agent.model.defaultThinkingLevel,
                },
                settings,
            });
        },
        processManager,
        searchFiles: (query) =>
            localServer.client
                .searchFiles(session.session.id, query)
                .then((response) => response.files),
        sessionBacked: true,
        showReasoning,
        tui,
        version: readPackageVersion(),
    });
    startup.stop();
    const followController = new AbortController();
    const lastHistoryEventId = history.events.at(-1)?.id ?? session.session.lastEventId;
    void localServer.client.watchSessionEvents({
        ...(lastHistoryEventId !== undefined ? { after: lastHistoryEventId } : {}),
        onEvent: (event) => {
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
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        followController.abort();
        await processManager.killAll({ forceAfterMs: 500 });
        console.error("");
        console.error(`Session: ${session.session.id}`);
        console.error(`Resume: ${resumeCommand}`);
    }
}
