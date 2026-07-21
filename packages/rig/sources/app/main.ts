import { runDaemonCommand, type DaemonCommand } from "./runDaemonCommand.js";
import { runApp, type RunAppOptions } from "./runApp.js";
import { runMonit } from "./runMonit.js";
import { runExec } from "./runExec.js";
import { parsePermissionMode } from "../permissions/index.js";
import { runLocalProtocolServer } from "../server/index.js";
import { parseExecCommand } from "./parseExecCommand.js";
import { parseSessionCommand } from "./parseSessionCommand.js";
import { resolveSessionCommand } from "./resolveSessionCommand.js";
import { parseSessionEnvironmentOptions } from "./parseSessionEnvironmentOptions.js";
import { formatCliHelp } from "./formatCliHelp.js";
import { readPackageVersion } from "../readPackageVersion.js";

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
    if (argv.length === 1 && argv[0] === "--server") {
        await runLocalProtocolServer({
            happyIntegration: "enabled",
            ...(process.env.RIG_SERVER_SOCKET_PATH !== undefined
                ? { socketPath: process.env.RIG_SERVER_SOCKET_PATH }
                : {}),
            ...(process.env.RIG_SERVER_TOKEN_PATH !== undefined
                ? { tokenPath: process.env.RIG_SERVER_TOKEN_PATH }
                : {}),
        });
        return;
    }

    const parsedEnvironment = parseSessionEnvironmentOptions(argv);
    argv = parsedEnvironment.remaining;
    const [command, ...commandArgs] = argv;
    if (command === "--help" || command === "-h") {
        console.log(formatCliHelp());
        return;
    }
    if (command === "--version" || command === "-v") {
        console.log(`Rig ${readPackageVersion()}`);
        return;
    }
    const options: RunAppOptions = {
        cwd: process.cwd(),
        ...(parsedEnvironment.debug === true ? { debug: true } : {}),
        ...(parsedEnvironment.docker === undefined ? {} : { docker: parsedEnvironment.docker }),
    };
    if (command === "exec") {
        await runExec({
            ...parseExecCommand(commandArgs),
            ...(parsedEnvironment.debug === true ? { debug: true } : {}),
            ...(parsedEnvironment.docker === undefined ? {} : { docker: parsedEnvironment.docker }),
        });
        return;
    }
    if (command === "resume" || command === "fork") {
        if (parsedEnvironment.docker !== undefined) {
            throw new Error(
                "A resumed or forked session keeps its existing execution environment.",
            );
        }
        options.resumeSessionId = await resolveSessionCommand({
            command,
            cwd: options.cwd ?? process.cwd(),
            selection: parseSessionCommand(commandArgs),
        });
    }
    if (command === "daemon") {
        const daemonCommand = commandArgs[0];
        if (!isDaemonCommand(daemonCommand)) {
            throw new Error("Usage: rig daemon <start|stop|status|reload>");
        }
        await runDaemonCommand(daemonCommand);
        return;
    }
    if (command === "happy") {
        if (commandArgs.length !== 1 || commandArgs[0] !== "auth") {
            throw new Error("Usage: rig happy auth");
        }
        const { runHappyAuthCommand } = await import("../happy/index.js");
        await runHappyAuthCommand();
        return;
    }
    if (command === "monit") {
        await runMonit();
        return;
    }
    if (command !== undefined && command !== "resume" && command !== "fork") {
        const kind = command.startsWith("-") ? "option" : "command";
        throw new Error(`Unknown rig ${kind} '${command}'. Run 'rig --help' for usage.`);
    }
    if (process.env.OPENAI_API_KEY !== undefined) {
        options.apiKey = process.env.OPENAI_API_KEY;
    }
    if (process.env.RIG_EFFORT !== undefined) {
        options.effort = process.env.RIG_EFFORT;
    }
    if (process.env.RIG_MODEL !== undefined) {
        options.modelId = process.env.RIG_MODEL;
    }
    if (process.env.RIG_PROVIDER !== undefined) {
        options.providerId = process.env.RIG_PROVIDER;
    }
    if (process.env.RIG_PERMISSION_MODE !== undefined) {
        options.permissionMode = parsePermissionMode(process.env.RIG_PERMISSION_MODE);
    }

    await runApp(options);
}

function isDaemonCommand(value: string | undefined): value is DaemonCommand {
    return value === "start" || value === "stop" || value === "status" || value === "reload";
}
