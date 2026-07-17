import { createServer, type Server, Socket } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { encodeWirePacket } from "./encodeWirePacket.js";
import { RemoteTerminalProtocolClient } from "./RemoteTerminalProtocolClient.js";
import { RemoteTerminalProtocolServer } from "./RemoteTerminalProtocolServer.js";
import type { RemoteTerminalGridState } from "./types.js";
import { WirePacketType } from "./WirePacket.js";

const cleanups: (() => void | Promise<void>)[] = [];

afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("remote terminal recovery and hostile peers", () => {
    it("orders a successful resize before SIGWINCH output and rejects a failed resize", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const operations: string[] = [];
        let protocol!: RemoteTerminalProtocolServer;
        protocol = new RemoteTerminalProtocolServer({
            initialCols: 20,
            initialRows: 4,
            onInput() {},
            async onResize() {
                protocol.publishOutput(Buffer.from("sigwinch"));
                await gate;
            },
        });
        const endpoint = await listen(protocol);
        const client = new RemoteTerminalProtocolClient({
            clientId: "resize-race",
            replica: {
                applyGrid() {},
                applyVt(data) {
                    operations.push(`output:${Buffer.from(data).toString()}`);
                },
                resize(cols, rows) {
                    operations.push(`resize:${cols}x${rows}`);
                },
            },
            stream: await endpoint.connect(),
        });
        await client.ready;
        operations.length = 0;
        const resized = client.resize(30, 8);
        await vi.waitFor(() => expect(operations).toEqual([]));
        release();
        await resized;
        await vi.waitFor(() => expect(operations).toContain("output:sigwinch"));
        expect(operations).toEqual(["resize:30x8", "output:sigwinch"]);

        const failedProtocol = new RemoteTerminalProtocolServer({
            onInput() {},
            onResize() {
                throw new Error("resize refused");
            },
        });
        const failedEndpoint = await listen(failedProtocol);
        const failedResizes: string[] = [];
        const failed = new RemoteTerminalProtocolClient({
            clientId: "resize-rejected",
            replica: {
                applyGrid() {},
                applyVt() {},
                resize(cols, rows) {
                    failedResizes.push(`${cols}x${rows}`);
                },
            },
            stream: await failedEndpoint.connect(),
        });
        await failed.ready;
        await expect(failed.resize(90, 30)).rejects.toThrow();
        expect(failedResizes).toEqual(["80x24"]);
    });

    it("never falls back to a stale grid and orders durable exit after the final display", async () => {
        let releaseRaw!: () => void;
        const rawGate = new Promise<void>((resolve) => {
            releaseRaw = resolve;
        });
        const modes: string[] = [];
        const grids: RemoteTerminalGridState[] = [];
        const exits: (number | null)[] = [];
        const protocol = new RemoteTerminalProtocolServer({
            initialCols: 8,
            initialRows: 1,
            maxUnacknowledgedBytes: 4,
            wireChunkBytes: 4,
            onInput() {},
            onResize() {},
        });
        const endpoint = await listen(protocol);
        const client = new RemoteTerminalProtocolClient({
            clientId: "barriers",
            creditBytes: 4,
            onExit: (code) => exits.push(code),
            onMode: (mode) => modes.push(mode),
            replica: {
                applyGrid(state) {
                    grids.push(state);
                },
                async applyVt() {
                    await rawGate;
                },
                resize() {},
            },
            stream: await endpoint.connect(),
        });
        await client.ready;
        protocol.publishOutput(Buffer.from("1234"));
        protocol.publishOutput(Buffer.from("5678"));
        protocol.publishGrid(grid("stale", 4));
        await new Promise((resolve) => setImmediate(resolve));
        expect(modes).not.toContain("grid");
        protocol.publishGrid(grid("current", 8));
        protocol.publishExit(7);
        expect(exits).toEqual([]);
        releaseRaw();
        await vi.waitFor(() => expect(grids.at(-1)?.title).toBe("current"));
        await vi.waitFor(() => expect(exits).toEqual([7]));

        const lateGrids: RemoteTerminalGridState[] = [];
        const lateExits: (number | null)[] = [];
        const late = new RemoteTerminalProtocolClient({
            capabilities: { grid: true, vt: false },
            clientId: "late",
            onExit: (code) => lateExits.push(code),
            replica: {
                applyGrid(state) {
                    lateGrids.push(state);
                },
                applyVt() {},
                resize() {},
            },
            stream: await endpoint.connect(),
        });
        await late.ready;
        await vi.waitFor(() => expect(lateExits).toEqual([7]));
        expect(lateGrids.at(-1)?.coversOutputOffset).toBe(8);
    });

    it("forces semantic recovery when a disconnected client misses a resize", async () => {
        const protocol = new RemoteTerminalProtocolServer({
            initialCols: 20,
            initialRows: 4,
            onInput() {},
            onResize() {},
        });
        const endpoint = await listen(protocol);
        const target = new RemoteTerminalProtocolClient({
            clientId: "missed-resize",
            replica: { applyGrid() {}, applyVt() {}, resize() {} },
            stream: await endpoint.connect(),
        });
        const controller = new RemoteTerminalProtocolClient({
            clientId: "controller",
            replica: { applyGrid() {}, applyVt() {}, resize() {} },
            stream: await endpoint.connect(),
        });
        await Promise.all([target.ready, controller.ready]);
        protocol.publishOutput(Buffer.from("before"));
        await vi.waitFor(() => expect(target.appliedOutputOffset).toBe(6));
        const stale = target.reconnectState();
        target.close();
        await new Promise((resolve) => setImmediate(resolve));
        await controller.resize(10, 3);
        protocol.publishGrid(grid("resized", 6));

        const recovered: RemoteTerminalGridState[] = [];
        const resumed = new RemoteTerminalProtocolClient({
            clientId: "missed-resize",
            epoch: stale.epoch!,
            inputLease: stale.inputLease!,
            pendingInputs: stale.pendingInputs,
            resumeInputSequence: stale.resumeInputSequence,
            resumeOutputOffset: stale.resumeOutputOffset,
            replica: {
                applyGrid(state) {
                    recovered.push(state);
                },
                applyVt() {
                    throw new Error("Missed resize must not raw-replay.");
                },
                resize() {},
            },
            stream: await endpoint.connect(),
        });
        await resumed.ready;
        await vi.waitFor(() => expect(recovered.at(-1)?.title).toBe("resized"));
        expect(resumed.mode).toBe("grid");
    });

    it("encodes shared output once for sixteen clients and bounds malicious acknowledgements", async () => {
        const protocol = new RemoteTerminalProtocolServer({ onInput() {}, onResize() {} });
        const endpoint = await listen(protocol);
        const clients = await Promise.all(
            Array.from({ length: 16 }, async (_, index) => {
                const client = new RemoteTerminalProtocolClient({
                    clientId: `fanout-${index}`,
                    creditBytes: 128 * 1024 + index * 1024,
                    replica: { applyGrid() {}, applyVt() {}, resize() {} },
                    stream: await endpoint.connect(),
                });
                await client.ready;
                return client;
            }),
        );
        const encodedBefore = protocol.metrics.encodedPackets;
        protocol.publishOutput(Buffer.from("dense".repeat(20_000)));
        await vi.waitFor(() =>
            expect(clients.every((client) => client.appliedOutputOffset === 100_000)).toBe(true),
        );
        expect(protocol.metrics.encodedPackets - encodedBefore).toBe(
            Math.ceil(100_000 / (16 * 1024)),
        );

        const tinyCredit = new RemoteTerminalProtocolClient({
            clientId: "hostile-credit-one",
            creditBytes: 1,
            replica: { applyGrid() {}, applyVt() {}, resize() {} },
            stream: await endpoint.connect(),
        });
        await expect(tinyCredit.ready).rejects.toThrow();

        const hostileProtocol = new RemoteTerminalProtocolServer({
            onInput() {},
            onResize() {},
            wireChunkBytes: 1_024,
        });
        const hostileEndpoint = await listen(hostileProtocol);
        const malicious = await hostileEndpoint.connect();
        malicious.resume();
        malicious.write(
            encodeWirePacket({
                payload: Buffer.from(
                    JSON.stringify({
                        capabilities: { grid: true, vt: true },
                        clientId: "malicious",
                        creditBytes: 1024,
                        parserFingerprint: "libghostty-vt/0.2/defaults",
                        resumeOutputOffset: 0,
                    }),
                ),
                sequence: 0,
                type: WirePacketType.ClientHello,
            }).data,
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
        hostileProtocol.publishOutput(Buffer.from("sent"));
        await new Promise((resolve) => setTimeout(resolve, 10));
        malicious.write(
            encodeWirePacket({
                payload: Buffer.alloc(0),
                sequence: Number.MAX_SAFE_INTEGER,
                type: WirePacketType.OutputAck,
            }).data,
        );
        await new Promise<void>((resolve) => malicious.once("close", resolve));
        expect(malicious.destroyed).toBe(true);
    });

    it("replays an input exactly once when the acknowledgement is lost", async () => {
        const inputs: string[] = [];
        let firstServerSocket: Socket | undefined;
        const protocol = new RemoteTerminalProtocolServer({
            onInput(data) {
                inputs.push(Buffer.from(data).toString());
                firstServerSocket?.destroy();
                firstServerSocket = undefined;
            },
            onResize() {},
        });
        const endpoint = await listen(protocol, (socket) => {
            firstServerSocket ??= socket;
        });
        const first = new RemoteTerminalProtocolClient({
            clientId: "input-retry",
            replica: { applyGrid() {}, applyVt() {}, resize() {} },
            stream: await endpoint.connect(),
        });
        await first.ready;
        first.writeInput("only-once");
        await vi.waitFor(() => expect(inputs).toEqual(["only-once"]));
        await vi.waitFor(() => expect(first.reconnectState().pendingInputs).toHaveLength(1));
        const state = first.reconnectState();
        await new Promise((resolve) => setImmediate(resolve));
        const resumed = new RemoteTerminalProtocolClient({
            clientId: "input-retry",
            epoch: state.epoch!,
            inputLease: state.inputLease!,
            pendingInputs: state.pendingInputs,
            resumeInputSequence: state.resumeInputSequence,
            resumeOutputOffset: state.resumeOutputOffset,
            replica: { applyGrid() {}, applyVt() {}, resize() {} },
            stream: await endpoint.connect(),
        });
        await resumed.ready;
        await vi.waitFor(() => expect(resumed.reconnectState().pendingInputs).toHaveLength(0));
        expect(inputs).toEqual(["only-once"]);
    });

    it("preserves flood input including Ctrl-C and detects stale scrollback bases", async () => {
        const input: Buffer[] = [];
        let historyRevision = 1;
        const protocol = new RemoteTerminalProtocolServer({
            onInput(data) {
                input.push(Buffer.from(data));
            },
            onResize() {},
            onScrollback(start, count, basis) {
                if (basis !== undefined && basis.historyRevision !== historyRevision) {
                    throw new Error("Scrollback basis is stale.");
                }
                return {
                    baseRow: historyRevision === 1 ? 0 : 500,
                    count,
                    historyEpoch: "history-stable",
                    historyRevision,
                    rows: [],
                    start,
                    totalRows: 10_000,
                };
            },
        });
        const endpoint = await listen(protocol);
        const client = new RemoteTerminalProtocolClient({
            clientId: "flood-and-history",
            replica: { applyGrid() {}, applyVt() {}, resize() {} },
            stream: await endpoint.connect(),
        });
        await client.ready;
        for (let index = 0; index < 128; index += 1) client.writeInput("x");
        client.writeInput(Uint8Array.of(3));
        await vi.waitFor(() => expect(input).toHaveLength(129));
        expect(Buffer.concat(input).subarray(-1)).toEqual(Buffer.from([3]));

        const first = await client.requestScrollback(0, 100);
        historyRevision = 2;
        await expect(
            client.requestScrollback(100, 100, {
                historyEpoch: first.historyEpoch,
                historyRevision: first.historyRevision,
            }),
        ).rejects.toThrow();
    });

    it("streams a 1 MiB chunk through 96-byte credit and exits without deadlock", async () => {
        const flow: boolean[] = [];
        const exits: (number | null)[] = [];
        const protocol = new RemoteTerminalProtocolServer({
            maxBufferedBytes: 2 * 1024 * 1024,
            maxUnacknowledgedBytes: 96,
            wireChunkBytes: 96,
            onFlowControl: (paused) => flow.push(paused),
            onInput() {},
            onResize() {},
        });
        const endpoint = await listen(protocol);
        let received = 0;
        const client = new RemoteTerminalProtocolClient({
            capabilities: { grid: false, vt: true },
            clientId: "tiny-credit",
            creditBytes: 96,
            onExit: (code) => exits.push(code),
            replica: {
                applyGrid() {},
                applyVt(data) {
                    received += data.length;
                },
                resize() {},
            },
            stream: await endpoint.connect(),
        });
        await client.ready;
        protocol.publishOutput(Buffer.alloc(1024 * 1024, 0x78));
        protocol.publishExit(0);
        await vi.waitFor(() => expect(received).toBe(1024 * 1024), { timeout: 20_000 });
        await vi.waitFor(() => expect(exits).toEqual([0]), { timeout: 20_000 });
        expect(flow).toContain(true);
        expect(flow.at(-1)).toBe(false);
    }, 30_000);

    it("enforces byte caps when flow control is ignored and while resize is hung", async () => {
        let releaseOutput!: () => void;
        const outputGate = new Promise<void>((resolve) => {
            releaseOutput = resolve;
        });
        const capped = new RemoteTerminalProtocolServer({
            maxBufferedBytes: 1_024,
            maxUnacknowledgedBytes: 96,
            wireChunkBytes: 96,
            onInput() {},
            onResize() {},
        });
        const cappedEndpoint = await listen(capped);
        const cappedSocket = await cappedEndpoint.connect();
        cappedSocket.resume();
        const cappedClient = new RemoteTerminalProtocolClient({
            capabilities: { grid: false, vt: true },
            clientId: "ignored-flow-control",
            creditBytes: 96,
            replica: {
                applyGrid() {},
                async applyVt() {
                    await outputGate;
                },
                resize() {},
            },
            stream: cappedSocket,
        });
        await cappedClient.ready;
        capped.publishOutput(Buffer.alloc(4_096));
        await vi.waitFor(() => expect(cappedSocket.destroyed).toBe(true));
        releaseOutput();

        let resizeStarted = false;
        let releaseResize!: () => void;
        const resizeGate = new Promise<void>((resolve) => {
            releaseResize = resolve;
        });
        const resizing = new RemoteTerminalProtocolServer({
            maxBufferedBytes: 1_024,
            onInput() {},
            async onResize() {
                resizeStarted = true;
                await resizeGate;
            },
        });
        const resizeEndpoint = await listen(resizing);
        const resizeClient = new RemoteTerminalProtocolClient({
            clientId: "hung-resize",
            replica: { applyGrid() {}, applyVt() {}, resize() {} },
            stream: await resizeEndpoint.connect(),
        });
        await resizeClient.ready;
        const resized = resizeClient.resize(100, 30);
        await vi.waitFor(() => expect(resizeStarted).toBe(true));
        expect(() => resizing.publishOutput(Buffer.alloc(2_048))).toThrow("buffer is full");
        releaseResize();
        await resized;
    });

    it("rejects input and resize after durable exit", async () => {
        const input: Buffer[] = [];
        const protocol = new RemoteTerminalProtocolServer({
            onInput(data) {
                input.push(Buffer.from(data));
            },
            onResize() {},
        });
        protocol.publishExit(0);
        const endpoint = await listen(protocol);
        const resizeClient = new RemoteTerminalProtocolClient({
            clientId: "late-resize",
            replica: { applyGrid() {}, applyVt() {}, resize() {} },
            stream: await endpoint.connect(),
        });
        await resizeClient.ready;
        await expect(resizeClient.resize(90, 30)).rejects.toThrow();

        const inputSocket = await endpoint.connect();
        inputSocket.resume();
        const inputClient = new RemoteTerminalProtocolClient({
            clientId: "late-input",
            replica: { applyGrid() {}, applyVt() {}, resize() {} },
            stream: inputSocket,
        });
        await inputClient.ready;
        inputClient.writeInput("ignored");
        await vi.waitFor(() => expect(inputSocket.destroyed).toBe(true));
        expect(input).toEqual([]);
    });
});

function grid(
    title: string,
    coversOutputOffset: number,
): Omit<RemoteTerminalGridState, "revision"> {
    return {
        cols: 8,
        coversOutputOffset,
        cursor: { visible: true, x: 0, y: 0 },
        palette: [],
        rows: [
            {
                cells: [...title].map((text, x) => ({ styleId: 0, text, width: 1 as const, x })),
                wrapped: false,
            },
        ],
        startRow: 0,
        styles: [{}],
        title,
        totalRows: 1,
    };
}

async function listen(
    protocol: RemoteTerminalProtocolServer,
    onSocket?: (socket: Socket) => void,
): Promise<{ connect: () => Promise<Socket> }> {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
        sockets.add(socket);
        onSocket?.(socket);
        protocol.attach(socket);
        socket.once("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    cleanups.push(() => closeServer(server, sockets));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing TCP address.");
    return {
        connect: () =>
            new Promise((resolve, reject) => {
                const socket = new Socket();
                socket.once("error", reject);
                socket.connect(address.port, "127.0.0.1", () => {
                    socket.off("error", reject);
                    resolve(socket);
                });
            }),
    };
}

function closeServer(server: Server, sockets: Set<Socket>): Promise<void> {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(() => resolve()));
}
