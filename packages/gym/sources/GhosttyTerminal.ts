import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createRetryableMemo } from "./createRetryableMemo.js";
import type { TerminalColorScheme, TerminalSnapshot } from "./types.js";

const execFileAsync = promisify(execFile);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(packageRoot, "terminal", "Cargo.toml");
const binaryPath = join(
    packageRoot,
    "terminal",
    "target",
    "debug",
    process.platform === "win32" ? "rig-gym-terminal.exe" : "rig-gym-terminal",
);
const buildTerminalHelper = createRetryableMemo(() =>
    execFileAsync("cargo", ["build", "--manifest-path", manifestPath], {
        maxBuffer: 100 * 1024 * 1024,
    }).then(() => undefined),
);

interface HelperSnapshot extends Omit<TerminalSnapshot, "outputRevision"> {
    id: number;
}

interface HelperPtyWrite {
    data: string;
    event: "pty_write";
}

export class GhosttyTerminal {
    #buffer = "";
    #closed = false;
    #helper: ChildProcessWithoutNullStreams;
    #nextId = 1;
    #outputHandlers = new Set<(data: string) => void>();
    #outputRevision = 0;
    #pending = new Map<
        number,
        {
            outputRevision: number;
            reject: (error: unknown) => void;
            resolve: (snapshot: TerminalSnapshot) => void;
        }
    >();
    #ptyWriteHandlers = new Set<(data: string) => void>();
    #stderr = "";

    private constructor(helper: ChildProcessWithoutNullStreams) {
        this.#helper = helper;
        helper.stdout.setEncoding("utf8");
        helper.stdout.on("data", (chunk: string) => this.#onData(chunk));
        helper.stderr.setEncoding("utf8");
        helper.stderr.on("data", (chunk: string) => {
            this.#stderr += chunk;
        });
        helper.once("exit", (code, signal) => {
            this.#closed = true;
            const detail = this.#stderr.trim();
            const error = new Error(
                `libghostty-vt helper exited ${signal ?? `with code ${String(code)}`}${detail.length === 0 ? "." : `: ${detail}`}`,
            );
            for (const pending of this.#pending.values()) pending.reject(error);
            this.#pending.clear();
        });
    }

    static async create(
        cols: number,
        rows: number,
        colorScheme: TerminalColorScheme = "dark",
    ): Promise<GhosttyTerminal> {
        await buildTerminalHelper();
        const terminal = new GhosttyTerminal(spawn(binaryPath, [], { stdio: "pipe" }));
        terminal.resize(cols, rows);
        terminal.setColorScheme(colorScheme);
        return terminal;
    }

    close(): void {
        if (this.#closed) return;
        this.#closed = true;
        this.#helper.stdin.end();
    }

    resize(cols: number, rows: number): void {
        this.#send({ type: "resize", cols, rows });
    }

    onPtyWrite(handler: (data: string) => void): () => void {
        this.#ptyWriteHandlers.add(handler);
        return () => this.#ptyWriteHandlers.delete(handler);
    }

    onOutput(handler: (data: string) => void): () => void {
        this.#outputHandlers.add(handler);
        return () => this.#outputHandlers.delete(handler);
    }

    scrollBy(rows: number): void {
        this.#send({ type: "scroll_by", rows });
    }

    scrollToBottom(): void {
        this.#send({ type: "scroll_bottom" });
    }

    scrollToTop(): void {
        this.#send({ type: "scroll_top" });
    }

    setColorScheme(colorScheme: TerminalColorScheme): void {
        this.#send({ type: "set_color_scheme", color_scheme: colorScheme });
    }

    snapshot(): Promise<TerminalSnapshot> {
        const id = this.#nextId++;
        return new Promise((resolve, reject) => {
            this.#pending.set(id, { outputRevision: this.#outputRevision, reject, resolve });
            this.#send({ type: "snapshot", id });
        });
    }

    write(data: string): void {
        this.#outputRevision += 1;
        for (const handler of this.#outputHandlers) handler(data);
        this.#send({ type: "write", data: Buffer.from(data).toString("base64") });
    }

    #onData(chunk: string): void {
        this.#buffer += chunk;
        for (;;) {
            const newline = this.#buffer.indexOf("\n");
            if (newline < 0) return;
            const line = this.#buffer.slice(0, newline);
            this.#buffer = this.#buffer.slice(newline + 1);
            if (line.length === 0) continue;
            const message = JSON.parse(line) as HelperPtyWrite | HelperSnapshot;
            if (!("id" in message)) {
                const data = Buffer.from(message.data, "base64").toString("utf8");
                for (const handler of this.#ptyWriteHandlers) handler(data);
                continue;
            }
            const { id, ...snapshot } = message;
            const pending = this.#pending.get(id);
            if (pending === undefined) continue;
            this.#pending.delete(id);
            pending.resolve({ ...snapshot, outputRevision: pending.outputRevision });
        }
    }

    #send(message: object): void {
        if (this.#closed) throw new Error("libghostty-vt helper is closed.");
        this.#helper.stdin.write(`${JSON.stringify(message)}\n`);
    }
}
