import { randomUUID } from "node:crypto";

import { GhosttyState } from "./GhosttyState.js";
import type {
    RemoteTerminalProcess,
    RemoteTerminalProcessFactory,
    RemoteTerminalProcessOptions,
} from "./RemoteTerminalProcess.js";
import type { RemoteTerminalFrame, RemoteTerminalViewport } from "./types.js";

const RETAINED_REVISIONS = 256;
const OUTPUT_COALESCE_MS = 16;

export class RemoteTerminal {
    readonly id = randomUUID();

    #current: RemoteTerminalFrame | undefined;
    #exitCode: number | null = null;
    #operation = Promise.resolve();
    #output: Uint8Array[] = [];
    #outputTimer: ReturnType<typeof setTimeout> | undefined;
    #process: RemoteTerminalProcess;
    #revision = 0;
    #state: GhosttyState;
    #status: "exited" | "running" = "running";
    #subscribers = new Set<(frame: RemoteTerminalFrame) => void>();
    #unsubscribeData: () => void;
    #unsubscribePtyWrite: () => void;

    private constructor(state: GhosttyState, process: RemoteTerminalProcess) {
        this.#state = state;
        this.#process = process;
        this.#operation = this.#operation.then(() => this.#capture(false)).then(() => undefined);
        this.#unsubscribeData = process.onData((data) => this.#queueOutput(data));
        this.#unsubscribePtyWrite = state.onPtyWrite((data) => {
            void process.write(data);
        });
        void process.wait().then(({ exitCode }) => {
            void this.#enqueue(async () => {
                if (this.#outputTimer !== undefined) clearTimeout(this.#outputTimer);
                this.#outputTimer = undefined;
                await this.#flushOutput();
                this.#status = "exited";
                this.#exitCode = exitCode;
                this.#revision += 1;
                await this.#capture(true);
                this.#unsubscribeData();
                this.#unsubscribePtyWrite();
            });
        });
    }

    static async create(options: {
        cols: number;
        maxScrollback: number;
        processFactory: RemoteTerminalProcessFactory;
        processOptions: RemoteTerminalProcessOptions;
        rows: number;
    }): Promise<RemoteTerminal> {
        const state = await GhosttyState.create(options);
        try {
            const process = await options.processFactory.start(options.processOptions);
            const terminal = new RemoteTerminal(state, process);
            await terminal.#operation;
            return terminal;
        } catch (error) {
            state.close();
            throw error;
        }
    }

    async dispose(): Promise<void> {
        await this.stop();
        this.#state.close();
    }

    async stop(): Promise<RemoteTerminalFrame> {
        if (this.#status === "running") await this.#process.kill();
        await this.#process.wait();
        await this.#operation;
        return this.frame();
    }

    frame(): RemoteTerminalFrame {
        if (this.#current === undefined) throw new Error("The terminal is still starting.");
        return this.#current;
    }

    framesSince(after: number | undefined): readonly RemoteTerminalFrame[] | undefined {
        if (after === undefined) return [this.frame()];
        if (!Number.isSafeInteger(after) || after < 0) return undefined;
        if (after === this.#revision) return [];
        if (after < Math.max(0, this.#revision - RETAINED_REVISIONS) || after > this.#revision) {
            return undefined;
        }
        return [this.frame()];
    }

    async resize(cols: number, rows: number): Promise<RemoteTerminalFrame> {
        validateSize(cols, rows);
        return this.#enqueue(async () => {
            if (this.#status !== "running") throw new Error("The terminal has exited.");
            await this.#flushOutput();
            await this.#process.resize(cols, rows);
            this.#state.resize(cols, rows);
            this.#revision += 1;
            return this.#capture(true);
        });
    }

    async scrollback(startRow: number, rowCount: number): Promise<RemoteTerminalViewport> {
        return this.#enqueue(async () => {
            await this.#flushOutput();
            const viewport = await this.#state.snapshot(startRow, rowCount);
            return { ...withoutRequestId(viewport), revision: this.#revision };
        });
    }

    subscribe(listener: (frame: RemoteTerminalFrame) => void): () => void {
        this.#subscribers.add(listener);
        return () => this.#subscribers.delete(listener);
    }

    async write(data: string): Promise<boolean> {
        if (this.#status !== "running") return false;
        return this.#process.write(data);
    }

    #capture(publish: boolean): Promise<RemoteTerminalFrame> {
        return this.#state.snapshot().then((viewport) => {
            const frame: RemoteTerminalFrame = {
                ...withoutRequestId(viewport),
                exitCode: this.#exitCode,
                id: this.id,
                revision: this.#revision,
                status: this.#status,
            };
            this.#current = frame;
            if (publish) {
                for (const subscriber of this.#subscribers) subscriber(frame);
            }
            return frame;
        });
    }

    #enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
        const result = this.#operation.then(operation);
        this.#operation = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }

    async #flushOutput(): Promise<void> {
        const output = this.#output;
        if (output.length === 0) return;
        this.#output = [];
        this.#state.write(Buffer.concat(output.map((chunk) => Buffer.from(chunk))));
        this.#revision += 1;
        await this.#capture(true);
    }

    #queueOutput(data: Uint8Array): void {
        this.#output.push(data);
        if (this.#outputTimer !== undefined) return;
        this.#outputTimer = setTimeout(() => {
            this.#outputTimer = undefined;
            void this.#enqueue(() => this.#flushOutput());
        }, OUTPUT_COALESCE_MS);
    }
}

function validateSize(cols: number, rows: number): void {
    if (!Number.isSafeInteger(cols) || cols < 1 || cols > 500) {
        throw new Error("The terminal column count must be between 1 and 500.");
    }
    if (!Number.isSafeInteger(rows) || rows < 1 || rows > 200) {
        throw new Error("The terminal row count must be between 1 and 200.");
    }
}

function withoutRequestId<T extends { requestId: number }>(value: T): Omit<T, "requestId"> {
    const { requestId: _requestId, ...rest } = value;
    return rest;
}
