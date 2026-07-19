import { Duplex, PassThrough } from "node:stream";

import { RemoteTerminalProtocolClient } from "@slopus/ghostty-web";
import { describe, expect, it, vi } from "vitest";

import type { RemoteTerminalProcess } from "./RemoteTerminalProcess.js";
import { RemoteTerminal } from "./RemoteTerminal.js";

describe("RemoteTerminal", () => {
    it("publishes each PTY write immediately, encodes it once for concurrent viewers, and routes input through leases", async () => {
        const process = new FakeTerminalProcess();
        const terminal = await RemoteTerminal.create({
            cols: 20,
            maxScrollback: 100,
            processFactory: { start: () => Promise.resolve(process) },
            processOptions: { cols: 20, cwd: globalThis.process.cwd(), rows: 4 },
            rows: 4,
        });
        const firstOutput: Buffer[] = [];
        const secondOutput: Buffer[] = [];
        const first = attachClient(terminal, "first", firstOutput);
        const second = attachClient(terminal, "second", secondOutput);
        const timeout = vi.spyOn(globalThis, "setTimeout");
        try {
            await Promise.all([first.ready, second.ready]);
            const encodedBefore = terminal.metrics().encodedPackets;

            process.emit("instant");
            await vi.waitFor(() => {
                expect(Buffer.concat(firstOutput).toString()).toBe("instant");
                expect(Buffer.concat(secondOutput).toString()).toBe("instant");
            });

            expect(timeout.mock.calls.some((call) => call[1] === 16)).toBe(false);
            expect(terminal.metrics().encodedPackets - encodedBefore).toBe(1);
            first.writeInput("leased-input");
            await vi.waitFor(() => expect(process.writes.map(String)).toContain("leased-input"));

            process.exit(7);
            await vi.waitFor(() =>
                expect(terminal.summary()).toMatchObject({ exitCode: 7, status: "exited" }),
            );
        } finally {
            first.close();
            second.close();
            timeout.mockRestore();
            await terminal.dispose();
        }
    });

    it("publishes durable exit after an in-flight resize barrier settles", async () => {
        const process = new FakeTerminalProcess();
        process.blockResize();
        const terminal = await RemoteTerminal.create({
            cols: 20,
            maxScrollback: 100,
            processFactory: { start: () => Promise.resolve(process) },
            processOptions: { cols: 20, cwd: globalThis.process.cwd(), rows: 4 },
            rows: 4,
        });
        const exits: (number | null)[] = [];
        const client = attachClient(terminal, "resize-exit", [], (exitCode) => {
            exits.push(exitCode);
        });
        try {
            await client.ready;

            const resize = client.resize(30, 6);
            await vi.waitFor(() => expect(process.resizeStarted).toBe(true));
            process.exit(0);
            await Promise.resolve();
            expect(exits).toEqual([]);

            process.releaseResize();
            await resize;
            await vi.waitFor(() => expect(exits).toEqual([0]));
            expect(terminal.summary()).toMatchObject({ exitCode: 0, status: "exited" });
        } finally {
            process.releaseResize();
            client.close();
            await terminal.dispose();
        }
    });
});

function attachClient(
    terminal: RemoteTerminal,
    clientId: string,
    output: Buffer[],
    onExit?: (exitCode: number | null) => void,
): RemoteTerminalProtocolClient {
    const [serverStream, clientStream] = duplexPair();
    terminal.attach(serverStream);
    return new RemoteTerminalProtocolClient({
        capabilities: { grid: false, vt: true },
        clientId,
        ...(onExit === undefined ? {} : { onExit }),
        replica: {
            applyGrid() {},
            applyVt(data) {
                output.push(Buffer.from(data));
            },
            resize() {},
        },
        stream: clientStream,
    });
}

function duplexPair(): [Duplex, Duplex] {
    const firstToSecond = new PassThrough();
    const secondToFirst = new PassThrough();
    return [
        Duplex.from({ readable: secondToFirst, writable: firstToSecond }),
        Duplex.from({ readable: firstToSecond, writable: secondToFirst }),
    ];
}

class FakeTerminalProcess implements RemoteTerminalProcess {
    resizeStarted = false;
    readonly writes: (string | Uint8Array)[] = [];
    #dataListeners = new Set<(data: Uint8Array) => void>();
    #exit!: (value: { exitCode: number | null }) => void;
    readonly #exited = new Promise<{ exitCode: number | null }>((resolve) => {
        this.#exit = resolve;
    });
    #releaseResize: (() => void) | undefined;
    #resizeGate = Promise.resolve();

    blockResize(): void {
        this.#resizeGate = new Promise((resolve) => {
            this.#releaseResize = resolve;
        });
    }

    emit(data: string): void {
        for (const listener of this.#dataListeners) listener(Buffer.from(data));
    }

    exit(exitCode: number | null): void {
        this.#exit({ exitCode });
    }

    kill(): void {
        this.exit(143);
    }

    onData(listener: (data: Uint8Array) => void): () => void {
        this.#dataListeners.add(listener);
        return () => this.#dataListeners.delete(listener);
    }

    pause(): void {}

    releaseResize(): void {
        this.#releaseResize?.();
        this.#releaseResize = undefined;
    }

    resize(): Promise<void> {
        this.resizeStarted = true;
        return this.#resizeGate;
    }

    resume(): void {}

    wait(): Promise<{ exitCode: number | null }> {
        return this.#exited;
    }

    write(data: string | Uint8Array): boolean {
        this.writes.push(typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
        return true;
    }
}
