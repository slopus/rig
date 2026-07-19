import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";

import type Dockerode from "dockerode";

import type { DockerEnvironment } from "../execution/DockerEnvironment.js";
import { runDockerExec } from "../execution/runDockerExec.js";
import type {
    RemoteTerminalProcess,
    RemoteTerminalProcessFactory,
} from "./RemoteTerminalProcess.js";

export function createDockerRemoteTerminalProcessFactory(
    environment: DockerEnvironment,
): RemoteTerminalProcessFactory {
    return {
        async start(options) {
            const container = await environment.container();
            const shell = options.shell ?? "/bin/sh";
            const invokedCommand =
                options.command === undefined ? [shell] : [shell, "-lc", options.command];
            const pidFile = `/tmp/rig-terminal-${randomUUID()}.pid`;
            const exec = await container.exec({
                AttachStderr: true,
                AttachStdin: true,
                AttachStdout: true,
                Cmd: [
                    "/bin/sh",
                    "-c",
                    'echo $$ > "$1"; shift; exec "$@"',
                    "rig",
                    pidFile,
                    ...invokedCommand,
                ],
                Env: ["TERM=xterm-256color", `COLUMNS=${options.cols}`, `LINES=${options.rows}`],
                Tty: true,
                WorkingDir: options.cwd,
            });
            const stream = (await exec.start({
                hijack: true,
                stdin: true,
                Tty: true,
            })) as Duplex;
            const bufferedData: Uint8Array[] = [];
            let dataListener: ((data: Uint8Array) => void) | undefined;
            stream.on("data", (data: Buffer) => {
                if (dataListener === undefined) bufferedData.push(data);
                else dataListener(data);
            });
            let finished = false;
            const exit = waitForDockerTerminal(exec, stream).then((result) => {
                finished = true;
                void runDockerExec(container, ["rm", "-f", pidFile]).catch(() => undefined);
                return result;
            });
            const process: RemoteTerminalProcess = {
                async kill() {
                    if (finished) return;
                    await signalDockerTerminal(container, pidFile, "TERM");
                    await Promise.race([exit, delay(500)]);
                    if (!finished) {
                        await signalDockerTerminal(container, pidFile, "KILL");
                        await Promise.race([exit, delay(500)]);
                    }
                    if (!finished) stream.destroy();
                },
                onData(listener) {
                    dataListener = listener;
                    for (const data of bufferedData.splice(0)) listener(data);
                    return () => {
                        if (dataListener === listener) dataListener = undefined;
                    };
                },
                pause() {
                    stream.pause();
                },
                async resize(cols, rows) {
                    await exec.resize({ h: rows, w: cols });
                },
                resume() {
                    stream.resume();
                },
                wait: () => exit,
                write(data) {
                    return stream.write(data);
                },
            };
            return process;
        },
    };
}

function waitForDockerTerminal(
    exec: Dockerode.Exec,
    stream: Duplex,
): Promise<{ exitCode: number | null }> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            void exec
                .inspect()
                .then((details) => resolve({ exitCode: details.ExitCode }))
                .catch(() => resolve({ exitCode: null }));
        };
        stream.once("close", finish);
        stream.once("end", finish);
        stream.once("error", finish);
    });
}

function signalDockerTerminal(
    container: Dockerode.Container,
    pidFile: string,
    signal: "KILL" | "TERM",
): Promise<void> {
    return runDockerExec(container, [
        "/bin/sh",
        "-c",
        `pid=$(cat "$1" 2>/dev/null) || exit 0; kill -${signal} -- "-$pid" 2>/dev/null || kill -${signal} "$pid" 2>/dev/null || true`,
        "rig",
        pidFile,
    ]).then(() => undefined);
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
