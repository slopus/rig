import { ProcessTerminal, TUI } from "@earendil-works/pi-tui";

import { createNodeAgentContext } from "../agent/index.js";
import { ensureLocalProtocolServer, RemoteAgent } from "../client/index.js";
import { loadConfig, writeRuntimeConfig } from "../config/index.js";
import { NativeProxessManager } from "../processes/index.js";
import type { SessionEvent } from "../protocol/index.js";
import { CodingAssistantApp } from "./CodingAssistantApp.js";
import { type CreateCodingAssistantAgentOptions } from "./createCodingAssistantAgent.js";
import { createStopOnceHandler } from "./createStopOnceHandler.js";
import { readPackageVersion } from "./readPackageVersion.js";

export interface RunAppOptions {
    apiKey?: string;
    cwd?: string;
    effort?: string;
    instructions?: string;
    modelId?: string;
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
    let showReasoning = options.showReasoning ?? loadedConfig.config.settings.showReasoning;

    const localServer = await ensureLocalProtocolServer();
    const session =
        options.resumeSessionId === undefined
            ? await localServer.client.createSession(agentOptions)
            : await localServer.client.getSession(options.resumeSessionId);
    const history =
        options.resumeSessionId === undefined
            ? { events: [] as SessionEvent[] }
            : await localServer.client.getEvents(session.session.id);
    const processManager = new NativeProxessManager();
    const sessionCwd = session.session.cwd;
    const context = createNodeAgentContext({ cwd: sessionCwd, processManager });
    const agent = new RemoteAgent({
        client: localServer.client,
        context,
        session: session.session,
    });
    const resumeCommand = `ohmypi resume ${session.session.id}`;
    // The app renders a softened fake cursor; keep the terminal cursor hidden
    // so the two blink loops do not compete.
    const tui = new TUI(new ProcessTerminal(), false);
    const app = new CodingAssistantApp({
        agent,
        cwd: sessionCwd,
        initialSessionEvents: history.events,
        onDefaultModelChange: (preference) =>
            writeRuntimeConfig(loadedConfig.paths.runtime, {
                defaults: {
                    modelId: preference.modelId,
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
                    effort: agent.snapshot().effort ?? agent.model.defaultThinkingLevel,
                },
                settings,
            });
        },
        processManager,
        showReasoning,
        tui,
        version: readPackageVersion(),
    });
    const followController = new AbortController();
    if (
        options.resumeSessionId !== undefined &&
        (session.session.status === "queued" || session.session.status === "running")
    ) {
        const lastHistoryEventId = history.events.at(-1)?.id;
        void localServer.client.watchSessionEvents({
            ...(lastHistoryEventId !== undefined ? { after: lastHistoryEventId } : {}),
            onEvent: (event) => {
                app.applySessionEvent(event);
                if (event.type === "run_finished" || event.type === "run_error") {
                    followController.abort();
                }
            },
            sessionId: session.session.id,
            signal: followController.signal,
        });
    }

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
        app.start();
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
