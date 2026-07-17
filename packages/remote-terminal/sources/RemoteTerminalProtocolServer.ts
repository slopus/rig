import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";

import { diffGridState } from "./diffGridState.js";
import { encodeWirePacket } from "./encodeWirePacket.js";
import { decodeJsonPayload, encodeJsonPayload } from "./jsonPayload.js";
import type {
    RemoteTerminalGridState,
    RemoteTerminalMode,
    RemoteTerminalProtocolMetrics,
    RemoteTerminalServerOptions,
} from "./types.js";
import { WirePacketDecoder } from "./WirePacketDecoder.js";
import { WirePacketType, type WirePacket } from "./WirePacket.js";

interface EncodedPacket {
    data: Buffer;
}

interface OutputChunk {
    data: Buffer;
    encoded: EncodedPacket;
    end: number;
    start: number;
}

interface ClientHello {
    capabilities: { grid: boolean; vt: boolean };
    clientId: string;
    creditBytes: number;
    epoch?: string;
    inputLease?: string;
    parserFingerprint: string;
    resumeOutputOffset: number;
}

interface InputLease {
    active: ServerConnection | undefined;
    lastUsed: number;
    outputOffset: number;
    resizeRevision: number;
    sequence: number;
}

interface ExitState {
    exitCode: number | null;
    outputOffset: number;
}

export class RemoteTerminalProtocolServer {
    readonly epoch: string;
    readonly metrics: RemoteTerminalProtocolMetrics = {
        compressedPackets: 0,
        encodedPackets: 0,
        payloadBytes: 0,
        wireBytes: 0,
    };
    readonly #connections = new Set<ServerConnection>();
    #cols: number;
    #deferredBytes = 0;
    readonly #deferredOutput: Buffer[] = [];
    readonly #deferredGrid: Omit<RemoteTerminalGridState, "revision">[] = [];
    readonly #deferredUpdates: {
        data: Buffer;
        state: Omit<RemoteTerminalGridState, "coversOutputOffset" | "revision">;
    }[] = [];
    #exit: ExitState | undefined;
    #failure: Error | undefined;
    #grid: RemoteTerminalGridState | undefined;
    readonly #gridPackets = new Map<number, EncodedPacket>();
    #gridRevision = 0;
    readonly #inputLeases = new Map<string, InputLease>();
    #lastResizeBarrier = 0;
    readonly #maxInputLeases: number;
    readonly #maxBufferedBytes: number;
    readonly #maxFrameBytes: number;
    readonly #maxReplayBytes: number;
    readonly #maxUnacknowledgedBytes: number;
    readonly #options: RemoteTerminalServerOptions;
    #outputChunks: OutputChunk[] = [];
    #outputOffset = 0;
    readonly #pausedConnections = new Set<ServerConnection>();
    #replayBytes = 0;
    #resizeOperation = Promise.resolve();
    #resizeRevision = 0;
    #resizing = false;
    #rows: number;
    readonly #wireChunkBytes: number;

    constructor(options: RemoteTerminalServerOptions) {
        this.#options = options;
        this.#maxReplayBytes = boundedInteger(
            options.maxReplayBytes ?? 4 * 1024 * 1024,
            1,
            64 * 1024 * 1024,
            "replay bytes",
        );
        this.#maxBufferedBytes = boundedInteger(
            options.maxBufferedBytes ?? this.#maxReplayBytes,
            1,
            64 * 1024 * 1024,
            "buffered bytes",
        );
        this.#maxInputLeases = boundedInteger(
            options.maxInputLeases ?? 1_024,
            1,
            65_536,
            "input leases",
        );
        this.#maxFrameBytes = boundedInteger(
            options.maxFrameBytes ?? 4 * 1024 * 1024,
            1,
            64 * 1024 * 1024,
            "frame bytes",
        );
        this.#wireChunkBytes = boundedInteger(
            options.wireChunkBytes ?? 16 * 1024,
            1,
            this.#maxFrameBytes,
            "wire chunk bytes",
        );
        this.#maxUnacknowledgedBytes = boundedInteger(
            options.maxUnacknowledgedBytes ?? 256 * 1024,
            this.#wireChunkBytes,
            64 * 1024 * 1024,
            "unacknowledged bytes",
        );
        this.#cols = boundedInteger(options.initialCols ?? 80, 1, 1_000, "initial columns");
        this.#rows = boundedInteger(options.initialRows ?? 24, 1, 1_000, "initial rows");
        this.epoch = options.epoch ?? randomUUID();
    }

    attach(stream: Duplex): () => void {
        const connection = new ServerConnection(this, stream, this.#maxFrameBytes);
        this.#connections.add(connection);
        let removed = false;
        const cleanup = () => {
            if (removed) return;
            removed = true;
            connection.close();
            this.#connections.delete(connection);
            this.releaseInputLease(connection);
            this.setFlowPaused(connection, false);
        };
        stream.once("close", cleanup);
        if (this.#failure !== undefined) queueMicrotask(() => connection.fail(this.#failure!));
        return cleanup;
    }

    publishExit(exitCode: number | null): void {
        if (this.#failure !== undefined) throw this.#failure;
        if (this.#exit !== undefined) return;
        if (this.#resizing) {
            this.#resizeOperation = this.#resizeOperation.then(() => this.publishExit(exitCode));
            return;
        }
        this.#exit = { exitCode, outputOffset: this.#outputOffset };
        for (const connection of this.#connections) connection.maybeSendExit();
    }

    publishGrid(state: Omit<RemoteTerminalGridState, "revision">): void {
        if (this.#failure !== undefined) throw this.#failure;
        if (this.#exit !== undefined) throw new Error("Terminal output has already exited.");
        if (
            !Number.isSafeInteger(state.coversOutputOffset) ||
            state.coversOutputOffset < 0 ||
            state.coversOutputOffset > this.#outputOffset
        ) {
            throw new Error("Grid output coverage is invalid.");
        }
        if (this.#resizing) {
            this.#reserveDeferredBytes(encodeJsonPayload(state).length);
            this.#deferredGrid.push(state);
        } else this.#commitGrid(state);
    }

    publishOutput(data: Uint8Array): void {
        if (this.#failure !== undefined) throw this.#failure;
        if (data.length === 0) return;
        if (this.#exit !== undefined) throw new Error("Terminal output has already exited.");
        if (this.#resizing) {
            this.#reserveDeferredBytes(data.length);
            this.#deferredOutput.push(Buffer.from(data));
            return;
        }
        this.#commitOutput(Buffer.from(data));
    }

    /** Parse output into the canonical emulator first, then publish bytes and its matching grid atomically. */
    publishUpdate(
        data: Uint8Array,
        state: Omit<RemoteTerminalGridState, "coversOutputOffset" | "revision">,
    ): void {
        if (this.#failure !== undefined) throw this.#failure;
        if (this.#exit !== undefined) throw new Error("Terminal output has already exited.");
        if (this.#resizing) {
            this.#reserveDeferredBytes(data.length);
            this.#deferredUpdates.push({ data: Buffer.from(data), state });
            return;
        }
        this.#commitOutput(Buffer.from(data));
        this.#commitGrid({ ...state, coversOutputOffset: this.#outputOffset });
    }

    claimInputLease(
        requested: string | undefined,
        connection: ServerConnection,
    ): { outputOffset: number; resizeRevision: number; sequence: number; token: string } {
        if (requested !== undefined) {
            validateString(requested, "input lease", 128);
            const lease = this.#inputLeases.get(requested);
            if (lease === undefined) throw new Error("Input lease is unavailable.");
            if (lease.active !== undefined && lease.active !== connection)
                throw new Error("Input lease is already attached.");
            lease.active = connection;
            lease.lastUsed = Date.now();
            return {
                outputOffset: lease.outputOffset,
                resizeRevision: lease.resizeRevision,
                sequence: lease.sequence,
                token: requested,
            };
        }
        while (this.#inputLeases.size >= this.#maxInputLeases) {
            const idle = [...this.#inputLeases].find(([, lease]) => lease.active === undefined);
            if (idle === undefined) throw new Error("Too many active input leases.");
            this.#inputLeases.delete(idle[0]);
        }
        const token = randomUUID();
        this.#inputLeases.set(token, {
            active: connection,
            lastUsed: Date.now(),
            outputOffset: 0,
            resizeRevision: 0,
            sequence: 0,
        });
        return { outputOffset: 0, resizeRevision: 0, sequence: 0, token };
    }

    releaseInputLease(connection: ServerConnection): void {
        for (const lease of this.#inputLeases.values()) {
            if (lease.active === connection) lease.active = undefined;
        }
    }

    async receiveInput(token: string, sequence: number, data: Uint8Array): Promise<void> {
        if (this.#failure !== undefined) throw this.#failure;
        if (this.#exit !== undefined) throw new Error("Terminal has exited.");
        const lease = this.#inputLeases.get(token);
        if (lease === undefined) throw new Error("Input lease is unavailable.");
        if (sequence <= lease.sequence) return;
        if (sequence !== lease.sequence + 1) throw new Error("Client input sequence has a gap.");
        await this.#options.onInput(data);
        lease.sequence = sequence;
        lease.lastUsed = Date.now();
    }

    acknowledgeOutput(token: string, outputOffset: number): void {
        const lease = this.#inputLeases.get(token);
        if (lease === undefined) throw new Error("Input lease is unavailable.");
        lease.outputOffset = outputOffset;
        lease.lastUsed = Date.now();
    }

    acknowledgeResize(token: string, revision: number): void {
        const lease = this.#inputLeases.get(token);
        if (
            lease === undefined ||
            revision < lease.resizeRevision ||
            revision > this.#resizeRevision
        )
            throw new Error("Invalid resize acknowledgement.");
        lease.resizeRevision = revision;
        lease.lastUsed = Date.now();
    }

    requestResize(
        requester: ServerConnection,
        requestSequence: number,
        cols: number,
        rows: number,
    ): Promise<void> {
        if (this.#failure !== undefined) return Promise.reject(this.#failure);
        if (this.#exit !== undefined) return Promise.reject(new Error("Terminal has exited."));
        validateDimensions(cols, rows);
        const operation = this.#resizeOperation.then(async () => {
            await this.#options.onBeforeResize?.();
            const barrier = this.#outputOffset;
            this.#resizing = true;
            try {
                await this.#options.onResize(cols, rows);
                this.#cols = cols;
                this.#rows = rows;
                this.#lastResizeBarrier = barrier;
                this.#resizeRevision += 1;
                for (const connection of this.#connections) {
                    connection.sendResize(
                        cols,
                        rows,
                        barrier,
                        this.#resizeRevision,
                        connection === requester ? requestSequence : 0,
                    );
                }
            } finally {
                this.#resizing = false;
                this.#flushDeferredOutput();
            }
        });
        this.#resizeOperation = operation.catch(() => undefined);
        return operation;
    }

    scrollback(
        start: number,
        count: number,
        basis?: { historyEpoch: string; historyRevision: number },
    ) {
        if (this.#options.onScrollback === undefined)
            throw new Error("Scrollback paging is unavailable.");
        return this.#options.onScrollback(start, count, basis);
    }

    setFlowPaused(connection: ServerConnection, paused: boolean): void {
        const wasPaused = this.#pausedConnections.size > 0;
        if (paused) this.#pausedConnections.add(connection);
        else this.#pausedConnections.delete(connection);
        const isPaused = this.#pausedConnections.size > 0;
        if (wasPaused !== isPaused) this.#options.onFlowControl?.(isPaused);
    }

    encode(packet: WirePacket): EncodedPacket {
        if (packet.payload.length > this.#maxFrameBytes) {
            throw new Error("Outbound remote terminal frame is too large.");
        }
        const encoded = encodeWirePacket(packet);
        this.metrics.encodedPackets += 1;
        this.metrics.payloadBytes += encoded.payloadBytes;
        if (encoded.compressed) this.metrics.compressedPackets += 1;
        return { data: encoded.data };
    }

    gridPacket(grid: RemoteTerminalGridState): EncodedPacket {
        let packet = this.#gridPackets.get(grid.revision);
        if (packet === undefined) {
            packet = this.encode({
                payload: encodeJsonPayload(grid),
                sequence: grid.revision,
                type: WirePacketType.GridKeyframe,
            });
            this.#gridPackets.set(grid.revision, packet);
        }
        return packet;
    }

    dimensions(): { cols: number; rows: number } {
        return { cols: this.#cols, rows: this.#rows };
    }
    maxBufferedBytes(): number {
        return this.#maxBufferedBytes;
    }
    exitState(): ExitState | undefined {
        return this.#exit;
    }
    grid(): RemoteTerminalGridState | undefined {
        return this.#grid;
    }
    lastResizeBarrier(): number {
        return this.#lastResizeBarrier;
    }
    maxUnacknowledgedBytes(): number {
        return this.#maxUnacknowledgedBytes;
    }
    parserFingerprint(): string {
        return this.#options.parserFingerprint ?? "libghostty-vt/0.2/defaults";
    }
    oldestOutputOffset(): number {
        return this.#outputChunks[0]?.start ?? this.#outputOffset;
    }
    outputOffset(): number {
        return this.#outputOffset;
    }
    resizeRevision(): number {
        return this.#resizeRevision;
    }
    replayAfter(offset: number): readonly OutputChunk[] {
        return this.#outputChunks
            .filter((chunk) => chunk.end > offset)
            .map((chunk) =>
                offset > chunk.start
                    ? this.#makeOutputChunk(chunk.data.subarray(offset - chunk.start), offset)
                    : chunk,
            );
    }

    wireChunkBytes(): number {
        return this.#wireChunkBytes;
    }

    fail(error: unknown): void {
        if (this.#failure !== undefined) return;
        this.#failure = error instanceof Error ? error : new Error(String(error));
        for (const connection of this.#connections) connection.fail(this.#failure);
    }

    #commitGrid(state: Omit<RemoteTerminalGridState, "revision">): void {
        const previous = this.#grid;
        const next: RemoteTerminalGridState = { ...state, revision: ++this.#gridRevision };
        this.#grid = next;
        this.#gridPackets.clear();
        for (const connection of this.#connections) connection.publishGrid(previous, next);
    }

    #commitOutput(data: Buffer): void {
        if (data.length === 0) return;
        if (data.length > this.#wireChunkBytes) {
            for (let offset = 0; offset < data.length; offset += this.#wireChunkBytes) {
                this.#commitOutput(data.subarray(offset, offset + this.#wireChunkBytes));
            }
            return;
        }
        const chunk = this.#makeOutputChunk(data, this.#outputOffset);
        this.#outputOffset = chunk.end;
        this.#outputChunks.push(chunk);
        this.#replayBytes += data.length;
        while (this.#replayBytes > this.#maxReplayBytes && this.#outputChunks.length > 0) {
            const removed = this.#outputChunks.shift()!;
            this.#replayBytes -= removed.data.length;
        }
        for (const connection of this.#connections) connection.publishOutput(chunk);
    }

    #flushDeferredOutput(): void {
        const output = this.#deferredOutput.splice(0);
        const updates = this.#deferredUpdates.splice(0);
        const grids = this.#deferredGrid.splice(0);
        this.#deferredBytes = 0;
        if (this.#failure !== undefined) return;
        for (const data of output) this.#commitOutput(data);
        for (const update of updates) {
            this.#commitOutput(update.data);
            this.#commitGrid({ ...update.state, coversOutputOffset: this.#outputOffset });
        }
        for (const grid of grids) this.#commitGrid(grid);
    }

    #reserveDeferredBytes(length: number): void {
        if (this.#deferredBytes + length > this.#maxBufferedBytes) {
            throw new Error("Resize output buffer is full.");
        }
        this.#deferredBytes += length;
    }

    #makeOutputChunk(data: Buffer, start: number): OutputChunk {
        const end = start + data.length;
        return {
            data,
            encoded: this.encode({ payload: data, sequence: end, type: WirePacketType.Output }),
            end,
            start,
        };
    }
}

class ServerConnection {
    #acknowledgedOutput = 0;
    #blocked = false;
    #capabilities = { grid: false, vt: false };
    #closed = false;
    #creditBytes = 0;
    readonly #decoder: WirePacketDecoder;
    #exitSent = false;
    #gridAcknowledged: RemoteTerminalGridState | undefined;
    #gridInFlight: RemoteTerminalGridState | undefined;
    #initialized = false;
    #inputLease: string | undefined;
    #lastResizeRequest = 0;
    #maxSentOutput = 0;
    #mode: RemoteTerminalMode = "vt";
    #needsGridOffset: number | undefined;
    #operation = Promise.resolve();
    #pendingGrid: RemoteTerminalGridState | undefined;
    #pendingVtBytes = 0;
    readonly #pendingVt: OutputChunk[] = [];
    readonly #server: RemoteTerminalProtocolServer;
    readonly #stream: Duplex;

    constructor(server: RemoteTerminalProtocolServer, stream: Duplex, maxFrameBytes?: number) {
        this.#server = server;
        this.#stream = stream;
        this.#decoder = new WirePacketDecoder(maxFrameBytes);
        stream.on("data", (data: Buffer) => {
            try {
                const packets = this.#decoder.push(data);
                if (packets.length > 0) stream.pause();
                for (const packet of packets)
                    this.#operation = this.#operation.then(() => this.#receive(packet));
                void this.#operation
                    .then(() => {
                        if (!this.#closed) stream.resume();
                    })
                    .catch((error: unknown) => {
                        this.#sendError(error);
                        this.close();
                    });
            } catch (error) {
                this.#sendError(error);
                this.close();
            }
        });
        stream.on("drain", () => this.#drain());
        stream.on("error", () => this.close());
        stream.on("close", () => this.close());
    }

    close(): void {
        if (this.#closed) return;
        this.#closed = true;
        this.#server.releaseInputLease(this);
        this.#server.setFlowPaused(this, false);
        this.#stream.destroy();
    }

    fail(error: unknown): void {
        this.#sendError(error);
        this.close();
    }

    publishGrid(
        previous: RemoteTerminalGridState | undefined,
        next: RemoteTerminalGridState,
    ): void {
        if (!this.#initialized) return;
        if (
            this.#needsGridOffset !== undefined &&
            this.#capabilities.grid &&
            next.coversOutputOffset >= this.#needsGridOffset
        ) {
            this.#switchToGrid(next);
            return;
        }
        if (this.#mode !== "grid") return;
        if (this.#blocked || this.#gridInFlight !== undefined) {
            this.#pendingGrid = next;
            return;
        }
        this.#sendGrid(previous, next);
    }

    publishOutput(chunk: OutputChunk): void {
        if (!this.#initialized || this.#mode !== "vt") return;
        if (this.#needsGridOffset !== undefined) {
            this.#needsGridOffset = chunk.end;
            if (!this.#capabilities.grid) this.#queueVt(chunk);
            return;
        }
        if (chunk.end - this.#acknowledgedOutput > this.#creditBytes) {
            this.#needsGridOffset = chunk.end;
            if (this.#capabilities.grid) {
                const grid = this.#server.grid();
                if (grid !== undefined && grid.coversOutputOffset >= chunk.end)
                    this.#switchToGrid(grid);
            } else {
                this.#queueVt(chunk);
                this.#server.setFlowPaused(this, true);
            }
            return;
        }
        this.#sendOutput(chunk);
    }

    sendResize(
        cols: number,
        rows: number,
        barrier: number,
        resizeRevision: number,
        requestSequence: number,
    ): void {
        this.#sendPacket({
            payload: encodeJsonPayload({ barrier, cols, requestSequence, resizeRevision, rows }),
            sequence: barrier,
            type: WirePacketType.ResizeAck,
        });
    }

    maybeSendExit(): void {
        const exit = this.#server.exitState();
        if (exit === undefined || this.#exitSent || !this.#initialized) return;
        if (this.#mode === "vt") {
            if (this.#needsGridOffset !== undefined || this.#maxSentOutput < exit.outputOffset)
                return;
        } else if ((this.#gridAcknowledged?.coversOutputOffset ?? -1) < exit.outputOffset) {
            const grid = this.#server.grid();
            if (
                grid !== undefined &&
                grid.coversOutputOffset >= exit.outputOffset &&
                this.#gridInFlight === undefined
            )
                this.#sendGridKeyframe(grid);
            return;
        }
        this.#sendPacket({
            payload: encodeJsonPayload(exit),
            sequence: exit.outputOffset,
            type: WirePacketType.Exit,
        });
        this.#exitSent = true;
    }

    #drain(): void {
        this.#blocked = false;
        this.#flushGrid();
    }

    async #initialize(packet: WirePacket): Promise<void> {
        if (packet.type !== WirePacketType.ClientHello)
            throw new Error("Client hello is required.");
        if (packet.payload.length > 4_096) throw new Error("Client hello is too large.");
        const hello = decodeJsonPayload<ClientHello>(packet.payload);
        validateHello(hello);
        const lease = this.#server.claimInputLease(hello.inputLease, this);
        this.#inputLease = lease.token;
        this.#capabilities = hello.capabilities;
        this.#creditBytes = Math.min(hello.creditBytes, this.#server.maxUnacknowledgedBytes());
        if (hello.creditBytes < this.#server.wireChunkBytes()) {
            throw new Error("Client credit is smaller than the server wire chunk.");
        }
        const epochMatches =
            (hello.epoch === undefined && hello.resumeOutputOffset === 0) ||
            hello.epoch === this.#server.epoch;
        const freshReplay =
            hello.inputLease === undefined &&
            hello.epoch === undefined &&
            hello.resumeOutputOffset === 0 &&
            this.#server.resizeRevision() === 0;
        const leasedReplay =
            hello.inputLease !== undefined &&
            epochMatches &&
            hello.resumeOutputOffset === lease.outputOffset &&
            lease.resizeRevision === this.#server.resizeRevision();
        const canReplay =
            hello.capabilities.vt &&
            hello.parserFingerprint === this.#server.parserFingerprint() &&
            (freshReplay || leasedReplay) &&
            hello.resumeOutputOffset >= this.#server.oldestOutputOffset() &&
            hello.resumeOutputOffset <= this.#server.outputOffset();
        if (!canReplay && !hello.capabilities.grid)
            throw new Error("Terminal replay is unavailable.");
        this.#mode = canReplay ? "vt" : "grid";
        this.#acknowledgedOutput = canReplay ? hello.resumeOutputOffset : 0;
        const dimensions = this.#server.dimensions();
        this.#sendPacket({
            payload: encodeJsonPayload({
                ...dimensions,
                epoch: this.#server.epoch,
                gridRevision: this.#server.grid()?.revision ?? 0,
                inputLease: lease.token,
                inputSequence: lease.sequence,
                resizeRevision: this.#server.resizeRevision(),
                mode: this.#mode,
                oldestOutputOffset: this.#server.oldestOutputOffset(),
                outputOffset: this.#server.outputOffset(),
            }),
            sequence: this.#server.outputOffset(),
            type: WirePacketType.Welcome,
        });
        this.#initialized = true;
        if (this.#mode === "vt") {
            for (const chunk of this.#server.replayAfter(hello.resumeOutputOffset))
                this.publishOutput(chunk);
            const grid = this.#server.grid();
            if (
                this.#needsGridOffset !== undefined &&
                grid !== undefined &&
                grid.coversOutputOffset >= this.#needsGridOffset
            )
                this.#switchToGrid(grid);
        } else {
            const grid = this.#server.grid();
            if (grid === undefined || grid.coversOutputOffset < this.#server.outputOffset())
                throw new Error("A current semantic terminal keyframe is unavailable.");
            this.#sendGridKeyframe(grid);
        }
        this.maybeSendExit();
    }

    async #receive(packet: WirePacket): Promise<void> {
        if (!this.#initialized) return this.#initialize(packet);
        if (packet.type === WirePacketType.OutputAck) {
            if (
                packet.payload.length !== 0 ||
                packet.sequence < this.#acknowledgedOutput ||
                packet.sequence > this.#maxSentOutput
            )
                throw new Error("Invalid output acknowledgement.");
            this.#acknowledgedOutput = packet.sequence;
            this.#server.acknowledgeOutput(this.#inputLease!, packet.sequence);
            this.#flushPendingVt();
            this.maybeSendExit();
            return;
        }
        if (packet.type === WirePacketType.GridAck) {
            if (
                packet.payload.length !== 0 ||
                this.#gridInFlight === undefined ||
                packet.sequence !== this.#gridInFlight.revision
            )
                throw new Error("Invalid grid acknowledgement.");
            this.#gridAcknowledged = this.#gridInFlight;
            this.#gridInFlight = undefined;
            this.#flushGrid();
            this.maybeSendExit();
            return;
        }
        if (packet.type === WirePacketType.Input) {
            if (packet.payload.length > 64 * 1024) throw new Error("Terminal input is too large.");
            await this.#server.receiveInput(this.#inputLease!, packet.sequence, packet.payload);
            this.#sendPacket({
                payload: Buffer.alloc(0),
                sequence: packet.sequence,
                type: WirePacketType.InputAck,
            });
            return;
        }
        if (packet.type === WirePacketType.Resize) {
            if (packet.payload.length > 1_024 || packet.sequence !== this.#lastResizeRequest + 1)
                throw new Error("Invalid resize sequence.");
            this.#lastResizeRequest = packet.sequence;
            const value = decodeJsonPayload<{ cols: number; rows: number }>(packet.payload);
            await this.#server.requestResize(this, packet.sequence, value.cols, value.rows);
            return;
        }
        if (packet.type === WirePacketType.ResizeApplied) {
            if (packet.payload.length !== 0) throw new Error("Invalid resize acknowledgement.");
            this.#server.acknowledgeResize(this.#inputLease!, packet.sequence);
            return;
        }
        if (packet.type === WirePacketType.Resync) {
            if (packet.payload.length !== 0) throw new Error("Invalid resync request.");
            const grid = this.#server.grid();
            if (grid === undefined || grid.coversOutputOffset < this.#server.outputOffset())
                throw new Error("A current semantic terminal keyframe is unavailable.");
            this.#switchToGrid(grid);
            return;
        }
        if (packet.type === WirePacketType.ScrollbackRequest) {
            if (packet.payload.length > 1_024) throw new Error("Scrollback request is too large.");
            const value = decodeJsonPayload<{
                basis?: { historyEpoch: string; historyRevision: number };
                count: number;
                start: number;
            }>(packet.payload);
            validateScrollbackRequest(value);
            const page = await this.#server.scrollback(value.start, value.count, value.basis);
            validateScrollbackPage(page, value.start, value.count);
            this.#sendPacket({
                payload: encodeJsonPayload(page),
                sequence: packet.sequence,
                type: WirePacketType.ScrollbackPage,
            });
            return;
        }
        throw new Error("Packet is invalid in the current server state.");
    }

    #flushGrid(): void {
        const grid = this.#pendingGrid;
        if (grid !== undefined && !this.#blocked && this.#gridInFlight === undefined) {
            this.#pendingGrid = undefined;
            this.#sendGridKeyframe(grid);
        }
    }

    #flushPendingVt(): void {
        while (this.#pendingVt.length > 0) {
            const next = this.#pendingVt[0]!;
            if (next.end - this.#acknowledgedOutput > this.#creditBytes) break;
            this.#pendingVt.shift();
            this.#pendingVtBytes -= next.data.length;
            this.#sendOutput(next);
        }
        if (this.#pendingVt.length === 0) {
            this.#needsGridOffset = undefined;
            this.#server.setFlowPaused(this, false);
        }
    }

    #queueVt(chunk: OutputChunk): void {
        if (this.#pendingVtBytes + chunk.data.length > this.#server.maxBufferedBytes()) {
            this.fail(new Error("Client terminal output buffer is full."));
            return;
        }
        this.#pendingVt.push(chunk);
        this.#pendingVtBytes += chunk.data.length;
    }

    #sendEncoded(packet: EncodedPacket): void {
        if (this.#closed) return;
        this.#server.metrics.wireBytes += packet.data.length;
        this.#blocked ||= !this.#stream.write(packet.data);
    }

    #sendPacket(packet: WirePacket): void {
        this.#sendEncoded(this.#server.encode(packet));
    }

    #sendError(error: unknown): void {
        this.#sendPacket({
            payload: encodeJsonPayload({
                error: error instanceof Error ? error.message : String(error),
            }),
            sequence: 0,
            type: WirePacketType.Error,
        });
    }

    #sendGrid(previous: RemoteTerminalGridState | undefined, grid: RemoteTerminalGridState): void {
        const base = this.#gridAcknowledged;
        const patch =
            base === undefined || previous?.revision !== base.revision
                ? undefined
                : diffGridState(base, grid);
        if (patch === undefined) this.#sendEncoded(this.#server.gridPacket(grid));
        else
            this.#sendPacket({
                payload: encodeJsonPayload(patch),
                sequence: grid.revision,
                type: WirePacketType.GridPatch,
            });
        this.#gridInFlight = grid;
    }

    #sendGridKeyframe(grid: RemoteTerminalGridState): void {
        this.#sendEncoded(this.#server.gridPacket(grid));
        this.#gridInFlight = grid;
    }

    #sendOutput(chunk: OutputChunk): void {
        this.#sendEncoded(chunk.encoded);
        this.#maxSentOutput = Math.max(this.#maxSentOutput, chunk.end);
    }

    #switchToGrid(grid: RemoteTerminalGridState): void {
        if (this.#gridInFlight !== undefined) this.#pendingGrid = grid;
        this.#mode = "grid";
        this.#needsGridOffset = undefined;
        this.#pendingVt.length = 0;
        this.#pendingVtBytes = 0;
        this.#server.setFlowPaused(this, false);
        this.#sendPacket({
            payload: encodeJsonPayload({ mode: "grid" }),
            sequence: grid.revision,
            type: WirePacketType.Mode,
        });
        if (this.#gridInFlight === undefined) this.#sendGridKeyframe(grid);
    }
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
        throw new Error(`Invalid ${name}.`);
    return value;
}

function validateDimensions(cols: number, rows: number): void {
    boundedInteger(cols, 1, 1_000, "terminal columns");
    boundedInteger(rows, 1, 1_000, "terminal rows");
}

function validateString(
    value: unknown,
    name: string,
    maximumLength: number,
): asserts value is string {
    if (typeof value !== "string" || value.length < 1 || value.length > maximumLength)
        throw new Error(`Invalid ${name}.`);
}

function validateHello(hello: ClientHello): void {
    if (typeof hello !== "object" || hello === null) throw new Error("Invalid client hello.");
    validateString(hello.clientId, "client identifier", 128);
    validateString(hello.parserFingerprint, "parser fingerprint", 256);
    boundedInteger(hello.creditBytes, 1, 64 * 1024 * 1024, "client credit");
    boundedInteger(hello.resumeOutputOffset, 0, Number.MAX_SAFE_INTEGER, "resume output offset");
    if (hello.epoch !== undefined) validateString(hello.epoch, "terminal epoch", 128);
    if (
        typeof hello.capabilities !== "object" ||
        hello.capabilities === null ||
        typeof hello.capabilities.grid !== "boolean" ||
        typeof hello.capabilities.vt !== "boolean" ||
        (!hello.capabilities.grid && !hello.capabilities.vt)
    )
        throw new Error("Invalid client capabilities.");
}

function validateScrollbackRequest(value: {
    basis?: { historyEpoch: string; historyRevision: number };
    count: number;
    start: number;
}): void {
    boundedInteger(value.start, 0, Number.MAX_SAFE_INTEGER, "scrollback start");
    boundedInteger(value.count, 1, 1_000, "scrollback count");
    if (value.basis !== undefined) {
        validateString(value.basis.historyEpoch, "history epoch", 128);
        boundedInteger(value.basis.historyRevision, 0, Number.MAX_SAFE_INTEGER, "history revision");
    }
}

function validateScrollbackPage(
    page: {
        baseRow: number;
        count: number;
        historyEpoch: string;
        historyRevision: number;
        rows: readonly unknown[];
        start: number;
        totalRows: number;
    },
    start: number,
    count: number,
): void {
    validateString(page.historyEpoch, "history epoch", 128);
    boundedInteger(page.historyRevision, 0, Number.MAX_SAFE_INTEGER, "history revision");
    boundedInteger(page.baseRow, 0, Number.MAX_SAFE_INTEGER, "history base row");
    boundedInteger(page.start, 0, Number.MAX_SAFE_INTEGER, "scrollback page start");
    boundedInteger(page.totalRows, 0, Number.MAX_SAFE_INTEGER, "scrollback total rows");
    if (
        page.start !== start ||
        page.count !== count ||
        !Array.isArray(page.rows) ||
        page.rows.length > count
    )
        throw new Error("Invalid scrollback page.");
}
