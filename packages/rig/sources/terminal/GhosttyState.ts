import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { RemoteTerminalViewport } from "./types.js";

const execFileAsync = promisify(execFile);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = join(packageRoot, "terminal", "Cargo.toml");
const targetPath = join(packageRoot, ".terminal-target");
const compiledBinaryPath = join(
    targetPath,
    "debug",
    process.platform === "win32" ? "rig-terminal-state.exe" : "rig-terminal-state",
);
const executableName =
    process.platform === "win32" ? "rig-terminal-state.exe" : "rig-terminal-state";
let helperPath: Promise<string> | undefined;

interface HelperViewport extends Omit<RemoteTerminalViewport, "revision"> {
    requestId: number;
}

interface HelperPtyWrite {
    data: string;
    event: "pty_write";
}

export class GhosttyState {
    #buffer = "";
    #closed = false;
    #helper: ChildProcessWithoutNullStreams;
    #nextRequestId = 1;
    #pending = new Map<
        number,
        { reject: (error: unknown) => void; resolve: (viewport: HelperViewport) => void }
    >();
    #ptyWriteHandlers = new Set<(data: Uint8Array) => void>();
    #stderr = "";

    private constructor(helper: ChildProcessWithoutNullStreams) {
        this.#helper = helper;
        helper.stdout.setEncoding("utf8");
        helper.stdout.on("data", (chunk: string) => this.#onData(chunk));
        helper.stderr.setEncoding("utf8");
        helper.stderr.on("data", (chunk: string) => {
            this.#stderr += chunk;
        });
        helper.stdin.on("error", () => undefined);
        let failed = false;
        const fail = (error: Error) => {
            if (failed) return;
            failed = true;
            this.#closed = true;
            for (const pending of this.#pending.values()) pending.reject(error);
            this.#pending.clear();
        };
        helper.once("error", fail);
        helper.once("exit", (code, signal) => {
            const detail = this.#stderr.trim();
            fail(
                new Error(
                    `The terminal state helper exited ${signal ?? `with code ${String(code)}`}${detail.length === 0 ? "." : `: ${detail}`}`,
                ),
            );
        });
    }

    static async create(options: {
        cols: number;
        maxScrollback: number;
        rows: number;
    }): Promise<GhosttyState> {
        helperPath ??= resolveHelperPath().catch((error: unknown) => {
            helperPath = undefined;
            throw error;
        });
        const state = new GhosttyState(spawn(await helperPath, [], { stdio: "pipe" }));
        state.#send({
            cols: options.cols,
            max_scrollback: options.maxScrollback,
            rows: options.rows,
            type: "initialize",
        });
        return state;
    }

    close(): void {
        if (this.#closed) return;
        this.#closed = true;
        this.#helper.stdin.end();
    }

    onPtyWrite(handler: (data: Uint8Array) => void): () => void {
        this.#ptyWriteHandlers.add(handler);
        return () => this.#ptyWriteHandlers.delete(handler);
    }

    resize(cols: number, rows: number): void {
        this.#send({ cols, rows, type: "resize" });
    }

    snapshot(startRow?: number, rowCount?: number): Promise<HelperViewport> {
        const requestId = this.#nextRequestId++;
        return new Promise((resolve, reject) => {
            this.#pending.set(requestId, { reject, resolve });
            this.#send({
                request_id: requestId,
                ...(rowCount === undefined ? {} : { row_count: rowCount }),
                ...(startRow === undefined ? {} : { start_row: startRow }),
                type: "snapshot",
            });
        });
    }

    write(data: Uint8Array): void {
        this.#send({ data: Buffer.from(data).toString("base64"), type: "write" });
    }

    #onData(chunk: string): void {
        this.#buffer += chunk;
        for (;;) {
            const newline = this.#buffer.indexOf("\n");
            if (newline < 0) return;
            const line = this.#buffer.slice(0, newline);
            this.#buffer = this.#buffer.slice(newline + 1);
            if (line.length === 0) continue;
            const message = JSON.parse(line) as HelperPtyWrite | HelperViewport;
            if (!("requestId" in message)) {
                const data = Buffer.from(message.data, "base64");
                for (const handler of this.#ptyWriteHandlers) handler(data);
                continue;
            }
            const pending = this.#pending.get(message.requestId);
            if (pending === undefined) continue;
            this.#pending.delete(message.requestId);
            pending.resolve(message);
        }
    }

    #send(message: object): void {
        if (this.#closed) throw new Error("The terminal state helper is closed.");
        this.#helper.stdin.write(`${JSON.stringify(message)}\n`);
    }
}

async function resolveHelperPath(): Promise<string> {
    const configured = process.env.RIG_TERMINAL_STATE_HELPER?.trim();
    if (configured !== undefined && configured.length > 0) return configured;
    const packaged = join(
        packageRoot,
        "terminal",
        "bin",
        `${process.platform}-${process.arch}`,
        executableName,
    );
    if (existsSync(packaged)) return packaged;
    await execFileAsync(
        "cargo",
        ["build", "--manifest-path", manifestPath, "--target-dir", targetPath],
        { maxBuffer: 100 * 1024 * 1024 },
    );
    return compiledBinaryPath;
}
