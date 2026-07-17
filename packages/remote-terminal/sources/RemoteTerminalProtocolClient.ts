import type { Duplex } from "node:stream";

import { applyGridPatch } from "./applyGridPatch.js";
import { encodeWirePacket } from "./encodeWirePacket.js";
import { decodeJsonPayload, encodeJsonPayload } from "./jsonPayload.js";
import type {
    RemoteTerminalClientOptions,
    RemoteTerminalGridPatch,
    RemoteTerminalGridState,
    RemoteTerminalMode,
    RemoteTerminalScrollbackPage,
} from "./types.js";
import { WirePacketDecoder } from "./WirePacketDecoder.js";
import { WirePacketType, type WirePacket } from "./WirePacket.js";

interface Welcome {
    cols: number;
    epoch: string;
    inputLease: string;
    inputSequence: number;
    mode: RemoteTerminalMode;
    outputOffset: number;
    resizeRevision: number;
    rows: number;
}

export interface RemoteTerminalReconnectState {
    epoch: string | undefined;
    inputLease: string | undefined;
    pendingInputs: readonly { data: Uint8Array; sequence: number }[];
    resumeInputSequence: number;
    resumeOutputOffset: number;
}

export class RemoteTerminalProtocolClient {
    appliedOutputOffset: number;
    epoch: string | undefined;
    grid: RemoteTerminalGridState | undefined;
    inputLease: string | undefined;
    mode: RemoteTerminalMode | undefined;
    readonly ready: Promise<void>;
    readonly #decoder = new WirePacketDecoder();
    #inputSequence: number;
    #lastInputAck = 0;
    readonly #options: RemoteTerminalClientOptions;
    #operation = Promise.resolve();
    readonly #pendingInputs = new Map<number, Uint8Array>();
    readonly #pendingResizes = new Map<
        number,
        { reject: (error: unknown) => void; resolve: () => void }
    >();
    readonly #pendingScrollback = new Map<
        number,
        { reject: (error: unknown) => void; resolve: (page: RemoteTerminalScrollbackPage) => void }
    >();
    #readySettled = false;
    #rejectReady!: (error: unknown) => void;
    #resizeSequence = 0;
    #resolveReady!: () => void;
    #scrollbackSequence = 0;
    readonly #stream: Duplex;

    constructor(options: RemoteTerminalClientOptions) {
        validateClientOptions(options);
        this.#options = options;
        this.#stream = options.stream;
        this.epoch = options.epoch;
        this.inputLease = options.inputLease;
        this.appliedOutputOffset = options.resumeOutputOffset ?? 0;
        this.#inputSequence = options.resumeInputSequence ?? 0;
        for (const pending of options.pendingInputs ?? []) {
            if (
                !Number.isSafeInteger(pending.sequence) ||
                pending.sequence < 1 ||
                pending.sequence > this.#inputSequence
            )
                throw new Error("Invalid pending input sequence.");
            this.#pendingInputs.set(pending.sequence, Buffer.from(pending.data));
        }
        this.ready = new Promise((resolve, reject) => {
            this.#resolveReady = resolve;
            this.#rejectReady = reject;
        });
        options.stream.on("data", (data: Buffer) => {
            try {
                const packets = this.#decoder.push(data);
                if (packets.length > 0) options.stream.pause();
                for (const packet of packets)
                    this.#operation = this.#operation.then(() => this.#receive(packet));
                void this.#operation
                    .then(() => {
                        if (!options.stream.destroyed) options.stream.resume();
                    })
                    .catch((error: unknown) => options.stream.destroy(error as Error));
            } catch (error) {
                options.stream.destroy(error as Error);
            }
        });
        options.stream.once("error", (error) => this.#settleClosed(error));
        options.stream.once("close", () =>
            this.#settleClosed(new Error("Remote terminal connection closed.")),
        );
        this.#send({
            payload: encodeJsonPayload({
                capabilities: options.capabilities ?? { grid: true, vt: true },
                clientId: options.clientId,
                creditBytes: options.creditBytes ?? 256 * 1024,
                ...(options.epoch === undefined ? {} : { epoch: options.epoch }),
                ...(options.inputLease === undefined ? {} : { inputLease: options.inputLease }),
                resumeOutputOffset: this.appliedOutputOffset,
                parserFingerprint: options.parserFingerprint ?? "libghostty-vt/0.2/defaults",
            }),
            sequence: this.appliedOutputOffset,
            type: WirePacketType.ClientHello,
        });
    }

    close(): void {
        this.#stream.destroy();
    }

    reconnectState(): RemoteTerminalReconnectState {
        return {
            epoch: this.epoch,
            inputLease: this.inputLease,
            pendingInputs: [...this.#pendingInputs].map(([sequence, data]) => ({
                data: Buffer.from(data),
                sequence,
            })),
            resumeInputSequence: this.#inputSequence,
            resumeOutputOffset: this.appliedOutputOffset,
        };
    }

    requestScrollback(
        start: number,
        count: number,
        basis?: { historyEpoch: string; historyRevision: number },
    ): Promise<RemoteTerminalScrollbackPage> {
        if (
            !Number.isSafeInteger(start) ||
            start < 0 ||
            !Number.isSafeInteger(count) ||
            count < 1 ||
            count > 1_000 ||
            this.#pendingScrollback.size >= 128
        ) {
            return Promise.reject(new Error("Invalid scrollback request."));
        }
        const sequence = ++this.#scrollbackSequence;
        return new Promise((resolve, reject) => {
            this.#pendingScrollback.set(sequence, { reject, resolve });
            this.#send({
                payload: encodeJsonPayload({
                    ...(basis === undefined ? {} : { basis }),
                    count,
                    start,
                }),
                sequence,
                type: WirePacketType.ScrollbackRequest,
            });
        });
    }

    resize(cols: number, rows: number): Promise<void> {
        validateDimensions(cols, rows);
        if (this.#pendingResizes.size >= 32)
            return Promise.reject(new Error("Too many pending terminal resizes."));
        const sequence = ++this.#resizeSequence;
        return new Promise((resolve, reject) => {
            this.#pendingResizes.set(sequence, { reject, resolve });
            this.#send({
                payload: encodeJsonPayload({ cols, rows }),
                sequence,
                type: WirePacketType.Resize,
            });
        });
    }

    writeInput(data: Uint8Array | string): number {
        const bytes = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
        if (bytes.length > 64 * 1024) throw new Error("Terminal input is too large.");
        if (this.#pendingInputs.size >= 1_024)
            throw new Error("Too many unacknowledged terminal inputs.");
        this.#inputSequence += 1;
        this.#pendingInputs.set(this.#inputSequence, bytes);
        this.#send({ payload: bytes, sequence: this.#inputSequence, type: WirePacketType.Input });
        return this.#inputSequence;
    }

    #send(packet: WirePacket): void {
        if (this.#stream.destroyed) throw new Error("Remote terminal connection is closed.");
        this.#stream.write(encodeWirePacket(packet).data);
    }

    async #receive(packet: WirePacket): Promise<void> {
        if (packet.type === WirePacketType.Welcome) {
            if (this.#readySettled) throw new Error("Duplicate server welcome.");
            const welcome = decodeJsonPayload<Welcome>(packet.payload);
            validateWelcome(welcome);
            if (this.epoch !== undefined && this.epoch !== welcome.epoch)
                this.appliedOutputOffset = 0;
            this.epoch = welcome.epoch;
            this.inputLease = welcome.inputLease;
            this.mode = welcome.mode;
            this.#options.onMode?.(welcome.mode);
            await this.#options.replica.resize(welcome.cols, welcome.rows);
            this.#send({
                payload: Buffer.alloc(0),
                sequence: welcome.resizeRevision,
                type: WirePacketType.ResizeApplied,
            });
            for (const [sequence, data] of this.#pendingInputs) {
                if (sequence > welcome.inputSequence)
                    this.#send({ payload: data, sequence, type: WirePacketType.Input });
                else this.#pendingInputs.delete(sequence);
            }
            this.#lastInputAck = welcome.inputSequence;
            this.#readySettled = true;
            this.#resolveReady();
            return;
        }
        if (!this.#readySettled) throw new Error("Server welcome is required.");
        if (packet.type === WirePacketType.Output) {
            if (this.mode !== "vt") throw new Error("VT output received outside VT mode.");
            const start = packet.sequence - packet.payload.length;
            if (packet.sequence <= this.appliedOutputOffset) return;
            if (start !== this.appliedOutputOffset) {
                this.#send({ payload: Buffer.alloc(0), sequence: 0, type: WirePacketType.Resync });
                return;
            }
            await this.#options.replica.applyVt(packet.payload);
            this.appliedOutputOffset = packet.sequence;
            this.#send({
                payload: Buffer.alloc(0),
                sequence: this.appliedOutputOffset,
                type: WirePacketType.OutputAck,
            });
            return;
        }
        if (packet.type === WirePacketType.Mode) {
            const value = decodeJsonPayload<{ mode: RemoteTerminalMode }>(packet.payload);
            if (value.mode !== "grid") throw new Error("Invalid terminal mode transition.");
            this.mode = value.mode;
            this.#options.onMode?.(value.mode);
            return;
        }
        if (packet.type === WirePacketType.GridKeyframe) {
            const grid = decodeJsonPayload<RemoteTerminalGridState>(packet.payload);
            validateGrid(grid);
            this.grid = grid;
            this.mode = "grid";
            await this.#options.replica.applyGrid(grid);
            this.#send({
                payload: Buffer.alloc(0),
                sequence: grid.revision,
                type: WirePacketType.GridAck,
            });
            return;
        }
        if (packet.type === WirePacketType.GridPatch) {
            const patch = decodeJsonPayload<RemoteTerminalGridPatch>(packet.payload);
            if (this.grid === undefined || this.grid.revision !== patch.baseRevision) {
                this.#send({ payload: Buffer.alloc(0), sequence: 0, type: WirePacketType.Resync });
                return;
            }
            this.grid = applyGridPatch(this.grid, patch);
            validateGrid(this.grid);
            await this.#options.replica.applyGrid(this.grid);
            this.#send({
                payload: Buffer.alloc(0),
                sequence: this.grid.revision,
                type: WirePacketType.GridAck,
            });
            return;
        }
        if (packet.type === WirePacketType.InputAck) {
            if (
                packet.payload.length !== 0 ||
                packet.sequence < this.#lastInputAck ||
                packet.sequence > this.#inputSequence
            )
                throw new Error("Invalid input acknowledgement.");
            this.#lastInputAck = packet.sequence;
            for (const sequence of this.#pendingInputs.keys())
                if (sequence <= packet.sequence) this.#pendingInputs.delete(sequence);
            return;
        }
        if (packet.type === WirePacketType.ResizeAck) {
            const value = decodeJsonPayload<{
                barrier: number;
                cols: number;
                requestSequence: number;
                resizeRevision: number;
                rows: number;
            }>(packet.payload);
            validateDimensions(value.cols, value.rows);
            if (
                !Number.isSafeInteger(value.barrier) ||
                value.barrier < 0 ||
                (this.mode === "vt" && this.appliedOutputOffset !== value.barrier)
            )
                throw new Error("Resize output barrier mismatch.");
            await this.#options.replica.resize(value.cols, value.rows);
            this.#send({
                payload: Buffer.alloc(0),
                sequence: value.resizeRevision,
                type: WirePacketType.ResizeApplied,
            });
            if (value.requestSequence > 0) {
                const pending = this.#pendingResizes.get(value.requestSequence);
                if (pending === undefined) throw new Error("Unknown resize acknowledgement.");
                this.#pendingResizes.delete(value.requestSequence);
                pending.resolve();
            }
            return;
        }
        if (packet.type === WirePacketType.ScrollbackPage) {
            const pending = this.#pendingScrollback.get(packet.sequence);
            if (pending === undefined) throw new Error("Unknown scrollback response.");
            this.#pendingScrollback.delete(packet.sequence);
            pending.resolve(decodeJsonPayload(packet.payload));
            return;
        }
        if (packet.type === WirePacketType.Exit) {
            const value = decodeJsonPayload<{ exitCode: number | null; outputOffset: number }>(
                packet.payload,
            );
            if (this.mode === "vt" && this.appliedOutputOffset !== value.outputOffset)
                throw new Error("Exit output barrier mismatch.");
            if (this.mode === "grid" && (this.grid?.coversOutputOffset ?? -1) < value.outputOffset)
                throw new Error("Exit grid barrier mismatch.");
            this.#options.onExit?.(value.exitCode);
            return;
        }
        if (packet.type === WirePacketType.Error) {
            const value = decodeJsonPayload<{ error: string }>(packet.payload);
            throw new Error(value.error);
        }
        throw new Error("Packet is invalid in the current client state.");
    }

    #settleClosed(error: Error): void {
        if (!this.#readySettled) {
            this.#readySettled = true;
            this.#rejectReady(error);
        }
        for (const pending of this.#pendingResizes.values()) pending.reject(error);
        for (const pending of this.#pendingScrollback.values()) pending.reject(error);
        this.#pendingResizes.clear();
        this.#pendingScrollback.clear();
    }
}

function validateClientOptions(options: RemoteTerminalClientOptions): void {
    if (
        typeof options.clientId !== "string" ||
        options.clientId.length < 1 ||
        options.clientId.length > 128
    )
        throw new Error("Invalid client identifier.");
    const credit = options.creditBytes ?? 256 * 1024;
    if (!Number.isSafeInteger(credit) || credit < 1 || credit > 64 * 1024 * 1024)
        throw new Error("Invalid client credit.");
}

function validateDimensions(cols: number, rows: number): void {
    if (
        !Number.isSafeInteger(cols) ||
        cols < 1 ||
        cols > 1_000 ||
        !Number.isSafeInteger(rows) ||
        rows < 1 ||
        rows > 1_000
    )
        throw new Error("Invalid terminal dimensions.");
}

function validateWelcome(value: Welcome): void {
    validateDimensions(value.cols, value.rows);
    if (
        typeof value.epoch !== "string" ||
        value.epoch.length < 1 ||
        value.epoch.length > 128 ||
        typeof value.inputLease !== "string" ||
        value.inputLease.length < 1 ||
        value.inputLease.length > 128 ||
        !Number.isSafeInteger(value.inputSequence) ||
        value.inputSequence < 0 ||
        !Number.isSafeInteger(value.resizeRevision) ||
        value.resizeRevision < 0 ||
        (value.mode !== "vt" && value.mode !== "grid")
    )
        throw new Error("Invalid server welcome.");
}

function validateGrid(grid: RemoteTerminalGridState): void {
    if (
        !Number.isSafeInteger(grid.revision) ||
        grid.revision < 1 ||
        !Number.isSafeInteger(grid.coversOutputOffset) ||
        grid.coversOutputOffset < 0 ||
        !Number.isSafeInteger(grid.cols) ||
        grid.cols < 1 ||
        grid.cols > 1_000 ||
        !Array.isArray(grid.rows) ||
        grid.rows.length > 1_000 ||
        !Array.isArray(grid.styles) ||
        grid.styles.length > 4_096
    )
        throw new Error("Invalid terminal grid.");
}
