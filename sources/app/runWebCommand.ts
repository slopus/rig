import { spawn } from "node:child_process";

import { ensureLocalProtocolServer } from "../client/index.js";
import { resolvePortlessCliPath } from "./resolvePortlessCliPath.js";
import { webPortlessAppName, webPortlessUrl } from "./web/webPortlessRoute.js";

export async function runWebCommand(): Promise<void> {
    const localServer = await ensureLocalProtocolServer({
        onStatus(message) {
            console.log(message);
        },
    });
    const entrypoint = process.argv[1];
    if (entrypoint === undefined || entrypoint.length === 0) {
        throw new Error("Cannot locate the current CLI entrypoint.");
    }

    const portlessCliPath = await resolvePortlessCliPath();
    console.log(`Starting the web UI at ${webPortlessUrl}`);
    await runPortlessWebProcess({
        entrypoint,
        portlessCliPath,
        socketPath: localServer.paths.socketPath,
        tokenPath: localServer.paths.tokenPath,
    });
}

interface RunPortlessWebProcessOptions {
    entrypoint: string;
    portlessCliPath: string;
    socketPath: string;
    tokenPath: string;
}

function runPortlessWebProcess(options: RunPortlessWebProcessOptions): Promise<void> {
    const child = spawn(
        process.execPath,
        [
            options.portlessCliPath,
            webPortlessAppName,
            process.execPath,
            ...process.execArgv,
            options.entrypoint,
            "--web-server",
        ],
        {
            env: {
                ...process.env,
                RIG_SERVER_SOCKET_PATH: options.socketPath,
                RIG_SERVER_TOKEN_PATH: options.tokenPath,
                PORTLESS_HTTPS: "1",
                PORTLESS_TLD: "localhost",
            },
            stdio: "inherit",
        },
    );

    return new Promise<void>((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", (code, signal) => {
            if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") {
                resolve();
                return;
            }
            reject(new Error(`The web UI stopped unexpectedly with exit code ${code ?? signal}.`));
        });
    });
}
