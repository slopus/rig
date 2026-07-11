import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { TerminalSnapshot } from "./types.js";

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
let build: Promise<void> | undefined;

interface HelperSnapshot extends TerminalSnapshot {
    id: number;
}

export class GhosttyTerminal {
    #buffer = "";
    #closed = false;
    #helper: ChildProcessWithoutNullStreams;
    #nextId = 1;
    #pending = new Map<
        number,
        { reject: (error: unknown) => void; resolve: (snapshot: TerminalSnapshot) => void }
    >();
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

    static async create(cols: number, rows: number): Promise<GhosttyTerminal> {
        build ??= execFileAsync("cargo", ["build", "--manifest-path", manifestPath], {
            maxBuffer: 100 * 1024 * 1024,
        }).then(() => undefined);
        await build;
        const terminal = new GhosttyTerminal(spawn(binaryPath, [], { stdio: "pipe" }));
        terminal.resize(cols, rows);
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

    scrollBy(rows: number): void {
        this.#send({ type: "scroll_by", rows });
    }

    scrollToBottom(): void {
        this.#send({ type: "scroll_bottom" });
    }

    scrollToTop(): void {
        this.#send({ type: "scroll_top" });
    }

    snapshot(): Promise<TerminalSnapshot> {
        const id = this.#nextId++;
        return new Promise((resolve, reject) => {
            this.#pending.set(id, { reject, resolve });
            this.#send({ type: "snapshot", id });
        });
    }

    write(data: string): void {
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
            const { id, ...snapshot } = JSON.parse(line) as HelperSnapshot;
            const pending = this.#pending.get(id);
            if (pending === undefined) continue;
            this.#pending.delete(id);
            pending.resolve(snapshot);
        }
    }

    #send(message: object): void {
        if (this.#closed) throw new Error("libghostty-vt helper is closed.");
        this.#helper.stdin.write(`${JSON.stringify(message)}\n`);
    }
}
