import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import { killProcessTree } from "./killProcessTree.js";
import type {
    ManagedProcessStatus,
    ProcessKillOptions,
    ProcessRunOptions,
    ProcessRunResult,
    ProcessSnapshot,
    ProcessStartOptions,
} from "./types.js";

const DEFAULT_MAX_OUTPUT_BYTES = 512_000;
const DEFAULT_KILL_GRACE_MS = 1_000;
const EXIT_STDIO_IDLE_GRACE_MS = 100;
const CLEANUP_FORCE_GRACE_MS = 200;

export class NativeProxessManager {
    readonly #processes = new Map<string, ManagedProcess>();

    start(options: ProcessStartOptions): ManagedProcess {
        const process = new ManagedProcess(options, (id) => {
            this.#processes.delete(id);
        });
        this.#processes.set(process.id, process);
        return process;
    }

    async run(options: ProcessRunOptions): Promise<ProcessRunResult> {
        if (options.signal?.aborted) {
            return abortedResult(options);
        }

        const process = this.start({
            ...options,
            cleanupProcessGroupOnExit: options.cleanupProcessGroupOnExit ?? true,
        });
        let timedOut = false;
        let aborted = false;
        let timeout: NodeJS.Timeout | undefined;

        const kill = () => {
            void process.kill("SIGTERM", {
                forceAfterMs: options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
            });
        };
        const onAbort = () => {
            aborted = true;
            kill();
        };

        if (options.timeoutMs !== undefined) {
            timeout = setTimeout(() => {
                timedOut = true;
                kill();
            }, options.timeoutMs);
            timeout.unref();
        }
        options.signal?.addEventListener("abort", onAbort, { once: true });

        try {
            const result = await process.wait();
            return {
                ...result,
                timedOut,
                aborted,
                killed: result.killed || timedOut || aborted,
            };
        } finally {
            if (timeout !== undefined) clearTimeout(timeout);
            options.signal?.removeEventListener("abort", onAbort);
        }
    }

    get(id: string): ManagedProcess | undefined {
        return this.#processes.get(id);
    }

    snapshots(): ProcessSnapshot[] {
        return [...this.#processes.values()].map((process) => process.snapshot());
    }

    activeCount(): number {
        return this.#processes.size;
    }

    async writeStdin(id: string, data: string | Uint8Array): Promise<boolean> {
        const process = this.get(id);
        if (!process) return false;
        return process.writeStdin(data);
    }

    async kill(id: string, options: ProcessKillOptions = {}): Promise<boolean> {
        const process = this.get(id);
        if (!process) return false;
        await process.kill("SIGTERM", options);
        return true;
    }

    async killAll(options: ProcessKillOptions = {}): Promise<void> {
        await Promise.all(
            [...this.#processes.values()].map((process) => process.kill("SIGTERM", options)),
        );
    }
}

export class ManagedProcess {
    readonly id = randomUUID();
    readonly command: string;
    readonly cwd: string;
    readonly pid: number | null;

    readonly #child: ChildProcess;
    readonly #maxOutputBytes: number;
    readonly #cleanupProcessGroupOnExit: boolean;
    readonly #onDone: (id: string) => void;
    readonly #waitPromise: Promise<ProcessRunResult>;
    #resolveWait!: (result: ProcessRunResult) => void;
    #stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    #stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    #stdoutBytes = 0;
    #stderrBytes = 0;
    #status: ManagedProcessStatus = "running";
    #exitCode: number | null = null;
    #exitSignal: NodeJS.Signals | null = null;
    #stdoutEnded = false;
    #stderrEnded = false;
    #settled = false;
    #killed = false;
    #postExitTimer: NodeJS.Timeout | undefined;

    constructor(options: ProcessStartOptions, onDone: (id: string) => void) {
        this.command = options.command;
        this.cwd = options.cwd;
        this.#maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
        this.#cleanupProcessGroupOnExit = options.cleanupProcessGroupOnExit ?? false;
        this.#onDone = onDone;
        this.#waitPromise = new Promise((resolve) => {
            this.#resolveWait = resolve;
        });

        const shell = options.shell ?? defaultShell();
        this.#child = spawn(shell, shellArgs(shell, options.command), {
            cwd: options.cwd,
            detached: process.platform !== "win32",
            env: options.env ?? process.env,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
        });
        this.pid = this.#child.pid ?? null;
        this.#attachListeners();
    }

    get status(): ManagedProcessStatus {
        return this.#status;
    }

    snapshot(): ProcessSnapshot {
        return {
            id: this.id,
            pid: this.pid,
            command: this.command,
            cwd: this.cwd,
            status: this.#status,
            stdout: this.#stdout.toString("utf8"),
            stderr: this.#stderr.toString("utf8"),
        };
    }

    readOutput(
        stdoutOffset: number,
        stderrOffset: number,
    ): ProcessSnapshot & {
        stderrDelta: string;
        stderrOffset: number;
        stdoutDelta: string;
        stdoutOffset: number;
    } {
        const stdoutStartOffset = this.#stdoutBytes - this.#stdout.length;
        const stderrStartOffset = this.#stderrBytes - this.#stderr.length;
        const stdoutDeltaOffset = Math.max(
            0,
            Math.min(this.#stdout.length, stdoutOffset - stdoutStartOffset),
        );
        const stderrDeltaOffset = Math.max(
            0,
            Math.min(this.#stderr.length, stderrOffset - stderrStartOffset),
        );
        return {
            ...this.snapshot(),
            stderrDelta: this.#stderr.subarray(stderrDeltaOffset).toString("utf8"),
            stderrOffset: this.#stderrBytes,
            stdoutDelta: this.#stdout.subarray(stdoutDeltaOffset).toString("utf8"),
            stdoutOffset: this.#stdoutBytes,
        };
    }

    writeStdin(data: string | Uint8Array): boolean {
        if (this.#status !== "running" || this.#child.stdin === null) {
            return false;
        }
        return this.#child.stdin.write(data);
    }

    endStdin(data?: string | Uint8Array): void {
        if (this.#child.stdin === null || this.#child.stdin.destroyed) {
            return;
        }
        this.#child.stdin.end(data);
    }

    async kill(
        signal: NodeJS.Signals = "SIGTERM",
        options: ProcessKillOptions = {},
    ): Promise<void> {
        if (this.#settled) {
            return;
        }

        this.#killed = true;
        this.#status = "killed";
        if (this.pid !== null) {
            killProcessTree(this.pid, signal);
        }

        let force: NodeJS.Timeout | undefined;
        const forceAfterMs = options.forceAfterMs ?? DEFAULT_KILL_GRACE_MS;
        if (this.pid !== null && signal !== "SIGKILL" && forceAfterMs > 0) {
            force = setTimeout(() => {
                if (!this.#settled && this.pid !== null) {
                    killProcessTree(this.pid, "SIGKILL");
                }
            }, forceAfterMs);
            force.unref();
        }

        try {
            await this.#waitPromise;
        } finally {
            if (force !== undefined) clearTimeout(force);
            if (this.pid !== null && signal !== "SIGKILL") {
                killProcessTree(this.pid, "SIGKILL");
            }
        }
    }

    wait(): Promise<ProcessRunResult> {
        return this.#waitPromise;
    }

    #attachListeners(): void {
        this.#child.stdout?.on("data", this.#onStdoutData);
        this.#child.stderr?.on("data", this.#onStderrData);
        this.#child.stdout?.once("end", this.#onStdoutEnd);
        this.#child.stderr?.once("end", this.#onStderrEnd);
        this.#child.once("error", this.#onError);
        this.#child.once("exit", this.#onExit);
        this.#child.once("close", this.#onClose);
        this.#child.stdin?.on("error", () => undefined);
    }

    #onStdoutData = (chunk: Buffer): void => {
        this.#stdoutBytes += chunk.length;
        this.#stdout = appendCapped(this.#stdout, chunk, this.#maxOutputBytes);
        if (this.#exitCode !== null || this.#exitSignal !== null) {
            this.#armPostExitTimer();
        }
    };

    #onStderrData = (chunk: Buffer): void => {
        this.#stderrBytes += chunk.length;
        this.#stderr = appendCapped(this.#stderr, chunk, this.#maxOutputBytes);
        if (this.#exitCode !== null || this.#exitSignal !== null) {
            this.#armPostExitTimer();
        }
    };

    #onStdoutEnd = (): void => {
        this.#stdoutEnded = true;
        this.#maybeFinalizeAfterExit();
    };

    #onStderrEnd = (): void => {
        this.#stderrEnded = true;
        this.#maybeFinalizeAfterExit();
    };

    #onError = (error: Error): void => {
        const chunk = Buffer.from(error.message);
        this.#stderrBytes += chunk.length;
        this.#stderr = appendCapped(this.#stderr, chunk, this.#maxOutputBytes);
        this.#finalize(null, null);
    };

    #onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        this.#exitCode = code;
        this.#exitSignal = signal;
        this.#maybeFinalizeAfterExit();
        if (!this.#settled) {
            this.#armPostExitTimer();
        }
    };

    #onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
        this.#finalize(code, signal);
    };

    #maybeFinalizeAfterExit(): void {
        if (this.#settled || (this.#exitCode === null && this.#exitSignal === null)) {
            return;
        }
        if (this.#stdoutEnded && this.#stderrEnded) {
            this.#finalize(this.#exitCode, this.#exitSignal);
        }
    }

    #armPostExitTimer(): void {
        if (this.#postExitTimer !== undefined) {
            clearTimeout(this.#postExitTimer);
        }
        this.#postExitTimer = setTimeout(() => {
            this.#finalize(this.#exitCode, this.#exitSignal);
        }, EXIT_STDIO_IDLE_GRACE_MS);
        this.#postExitTimer.unref();
    }

    #finalize(code: number | null, signal: NodeJS.Signals | null): void {
        if (this.#settled) {
            return;
        }
        this.#settled = true;
        this.#exitCode = code;
        this.#exitSignal = signal;
        if (this.#status === "running") {
            this.#status = "exited";
        }

        this.#cleanupListeners();
        this.#child.stdout?.destroy();
        this.#child.stderr?.destroy();
        this.#child.stdin?.destroy();
        if (this.#cleanupProcessGroupOnExit && this.pid !== null && !this.#killed) {
            killProcessTree(this.pid, "SIGTERM");
            const force = setTimeout(() => {
                if (this.pid !== null) {
                    killProcessTree(this.pid, "SIGKILL");
                }
            }, CLEANUP_FORCE_GRACE_MS);
            force.unref();
        }

        this.#onDone(this.id);
        this.#resolveWait({
            ...this.snapshot(),
            exitCode: code,
            signal,
            timedOut: false,
            aborted: false,
            killed: this.#killed,
        });
    }

    #cleanupListeners(): void {
        if (this.#postExitTimer !== undefined) {
            clearTimeout(this.#postExitTimer);
            this.#postExitTimer = undefined;
        }
        this.#child.stdout?.removeListener("data", this.#onStdoutData);
        this.#child.stderr?.removeListener("data", this.#onStderrData);
        this.#child.stdout?.removeListener("end", this.#onStdoutEnd);
        this.#child.stderr?.removeListener("end", this.#onStderrEnd);
        this.#child.removeListener("error", this.#onError);
        this.#child.removeListener("exit", this.#onExit);
        this.#child.removeListener("close", this.#onClose);
    }
}

function defaultShell(): string {
    if (process.platform === "win32") {
        return process.env.ComSpec ?? "cmd.exe";
    }
    return process.env.SHELL ?? "/bin/sh";
}

function shellArgs(shell: string, command: string): string[] {
    if (process.platform === "win32") {
        const shellName = basename(shell).toLowerCase();
        if (shellName === "cmd.exe" || shellName === "cmd") {
            return ["/d", "/s", "/c", command];
        }
    }
    return ["-c", command];
}

function appendCapped(
    buffer: Buffer<ArrayBufferLike>,
    chunk: Buffer,
    maxBytes: number,
): Buffer<ArrayBufferLike> {
    const combined = Buffer.concat([buffer, chunk]);
    return combined.length <= maxBytes ? combined : combined.subarray(combined.length - maxBytes);
}

function abortedResult(options: ProcessRunOptions): ProcessRunResult {
    return {
        id: randomUUID(),
        pid: null,
        command: options.command,
        cwd: options.cwd,
        status: "killed",
        stdout: "",
        stderr: "",
        exitCode: null,
        signal: null,
        timedOut: false,
        aborted: true,
        killed: true,
    };
}
