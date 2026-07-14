import { PassThrough } from "node:stream";

import type Dockerode from "dockerode";

import { appendCappedChunk } from "./appendCappedChunk.js";

export interface DockerExecResult {
    exitCode: number | null;
    stderr: Buffer;
    stdout: Buffer;
}

export async function runDockerExec(
    container: Dockerode.Container,
    command: readonly string[],
    options: {
        cwd?: string;
        maxOutputBytes?: number;
        stdin?: string | Uint8Array;
        timeoutMs?: number;
    } = {},
): Promise<DockerExecResult> {
    const hasStdin = options.stdin !== undefined;
    const exec = await container.exec({
        AttachStdin: hasStdin,
        AttachStderr: true,
        AttachStdout: true,
        Cmd: [...command],
        Tty: false,
        ...(options.cwd === undefined ? {} : { WorkingDir: options.cwd }),
    });
    const stream = await exec.start({ hijack: true, stdin: hasStdin, Tty: false });
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    const maxOutputBytes = options.maxOutputBytes ?? 512_000;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    stdoutStream.on("data", (chunk: Buffer) => {
        stdoutBytes = appendCappedChunk(stdoutChunks, stdoutBytes, chunk, maxOutputBytes);
    });
    stderrStream.on("data", (chunk: Buffer) => {
        stderrBytes = appendCappedChunk(stderrChunks, stderrBytes, chunk, maxOutputBytes);
    });
    const completion = new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (error === undefined) resolve();
            else reject(error);
        };
        const timeout = setTimeout(() => {
            const error = new Error("Docker command timed out before it completed.");
            stream.destroy(error);
            finish(error);
        }, options.timeoutMs ?? 120_000);
        timeout.unref();
        stream.once("error", finish);
        stream.once("end", () => finish());
        stream.once("close", () => finish());
    });
    container.modem.demuxStream(stream, stdoutStream, stderrStream);
    if (options.stdin !== undefined) {
        stream.end(Buffer.from(options.stdin));
    }
    await completion;
    const inspected = await exec.inspect();
    return {
        exitCode: inspected.ExitCode,
        stderr: Buffer.concat(stderrChunks, stderrBytes),
        stdout: Buffer.concat(stdoutChunks, stdoutBytes),
    };
}
