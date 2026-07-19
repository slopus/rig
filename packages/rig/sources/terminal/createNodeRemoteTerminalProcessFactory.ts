import { basename } from "node:path";

import { spawn } from "@lydell/node-pty";

import type {
    RemoteTerminalProcess,
    RemoteTerminalProcessFactory,
} from "./RemoteTerminalProcess.js";

export function createNodeRemoteTerminalProcessFactory(
    environment: NodeJS.ProcessEnv = process.env,
): RemoteTerminalProcessFactory {
    return {
        async start(options) {
            const shell = options.shell ?? defaultShell(environment);
            const args =
                options.command === undefined ? [] : commandArguments(shell, options.command);
            const pty = spawn(shell, args, {
                cols: options.cols,
                cwd: options.cwd,
                env: environment as Record<string, string>,
                name: "xterm-256color",
                rows: options.rows,
            });
            const bufferedData: Uint8Array[] = [];
            let dataListener: ((data: Uint8Array) => void) | undefined;
            const dataSubscription = pty.onData((data) => {
                const chunk = Buffer.from(data);
                if (dataListener === undefined) bufferedData.push(chunk);
                else dataListener(chunk);
            });
            const exit = new Promise<{ exitCode: number | null }>((resolve) => {
                pty.onExit(({ exitCode }) => {
                    dataSubscription.dispose();
                    resolve({ exitCode });
                });
            });
            const process: RemoteTerminalProcess = {
                kill() {
                    pty.kill();
                },
                onData(listener) {
                    dataListener = listener;
                    for (const data of bufferedData.splice(0)) listener(data);
                    return () => {
                        if (dataListener === listener) dataListener = undefined;
                    };
                },
                pause() {
                    pty.pause();
                },
                resize(cols, rows) {
                    pty.resize(cols, rows);
                },
                resume() {
                    pty.resume();
                },
                wait: () => exit,
                write(data) {
                    pty.write(typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
                    return true;
                },
            };
            return process;
        },
    };
}

function defaultShell(environment: NodeJS.ProcessEnv): string {
    if (process.platform === "win32") return environment.ComSpec ?? "cmd.exe";
    return environment.SHELL ?? "/bin/sh";
}

function commandArguments(shell: string, command: string): string[] {
    if (process.platform === "win32") {
        const name = basename(shell).toLowerCase();
        if (name === "cmd" || name === "cmd.exe") return ["/d", "/s", "/c", command];
    }
    return ["-lc", command];
}
