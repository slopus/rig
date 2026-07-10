import { runDaemonCommand, type DaemonCommand } from "./runDaemonCommand.js";
import { runApp, type RunAppOptions } from "./runApp.js";
import { runMonit } from "./runMonit.js";
import { runWebCommand } from "./runWebCommand.js";
import { runWebServer } from "./web/runWebServer.js";
import { runLocalProtocolServer } from "../server/index.js";

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
    if (argv.includes("--web-server")) {
        await runWebServer();
        return;
    }

    if (argv.includes("--server")) {
        await runLocalProtocolServer({
            ...(process.env.OHMYPI_SERVER_SOCKET_PATH !== undefined
                ? { socketPath: process.env.OHMYPI_SERVER_SOCKET_PATH }
                : {}),
            ...(process.env.OHMYPI_SERVER_TOKEN_PATH !== undefined
                ? { tokenPath: process.env.OHMYPI_SERVER_TOKEN_PATH }
                : {}),
        });
        return;
    }

    const options: RunAppOptions = {
        cwd: process.cwd(),
    };
    const [command, sessionId] = argv;
    if (command === "resume") {
        if (sessionId === undefined || sessionId.length === 0) {
            throw new Error("Usage: ohmypi resume <session-id>");
        }
        options.resumeSessionId = sessionId;
    }
    if (command === "daemon") {
        if (!isDaemonCommand(sessionId)) {
            throw new Error("Usage: ohmypi daemon <start|stop|status>");
        }
        await runDaemonCommand(sessionId);
        return;
    }
    if (command === "monit") {
        await runMonit();
        return;
    }
    if (command === "web") {
        await runWebCommand();
        return;
    }

    if (process.env.OPENAI_API_KEY !== undefined) {
        options.apiKey = process.env.OPENAI_API_KEY;
    }
    if (process.env.OHMYPI_EFFORT !== undefined) {
        options.effort = process.env.OHMYPI_EFFORT;
    }
    if (process.env.OHMYPI_MODEL !== undefined) {
        options.modelId = process.env.OHMYPI_MODEL;
    }
    if (process.env.OHMYPI_PROVIDER !== undefined) {
        options.providerId = process.env.OHMYPI_PROVIDER;
    }

    await runApp(options);
}

function isDaemonCommand(value: string | undefined): value is DaemonCommand {
    return value === "start" || value === "stop" || value === "status";
}
