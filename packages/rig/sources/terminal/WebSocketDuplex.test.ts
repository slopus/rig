import { describe, expect, it, vi } from "vitest";

import {
    encodeWirePacket,
    RemoteTerminalProtocolServer,
    type WirePacket,
} from "@slopus/ghostty-web";

import type { BinaryWebSocket, BinaryWebSocketHandlers } from "./BinaryWebSocket.js";
import { WebSocketDuplex } from "./WebSocketDuplex.js";

describe("WebSocketDuplex", () => {
    it("maps binary messages to stream chunks and tears down both directions", async () => {
        const socket = new FakeBinaryWebSocket();
        const stream = new WebSocketDuplex(socket);
        const received: Buffer[] = [];
        stream.on("data", (data: Buffer) => received.push(data));

        socket.receive(Buffer.from("server-packet"));
        await vi.waitFor(() => expect(Buffer.concat(received).toString()).toBe("server-packet"));

        await new Promise<void>((resolve, reject) => {
            stream.write(Buffer.from("client-packet"), (error) =>
                error === null || error === undefined ? resolve() : reject(error),
            );
        });
        expect(socket.sent.map((packet) => packet.toString())).toEqual(["client-packet"]);

        socket.disconnect();
        await vi.waitFor(() => expect(stream.destroyed).toBe(true));
        expect(socket.closed).toBe(true);
    });

    it("holds the stream write callback until WebSocket pressure drains and keeps one bounded write in flight", async () => {
        const socket = new FakeBinaryWebSocket();
        socket.delaySends = true;
        const stream = new WebSocketDuplex(socket, {
            bufferedAmountLowWaterMark: 32,
            writableHighWaterMark: 64,
        });
        let completed = 0;

        const accepted = stream.write(Buffer.alloc(96), () => {
            completed += 1;
        });
        expect(accepted).toBe(false);
        expect(completed).toBe(0);
        expect(socket.bufferedAmount).toBe(96);
        expect(stream.metrics.pendingWriteBytes).toBe(96);
        expect(stream.metrics.maxPendingWriteBytes).toBe(96);

        socket.finishSend();
        await vi.waitFor(() => expect(completed).toBe(1));
        expect(stream.metrics.pendingWriteBytes).toBe(0);
        expect(stream.metrics.maxPendingWriteBytes).toBe(96);
    });

    it("carries slow WebSocket pressure into the protocol's bounded credit window", async () => {
        const socket = new FakeBinaryWebSocket();
        socket.delaySends = true;
        const stream = new WebSocketDuplex(socket, { writableHighWaterMark: 64 * 1024 });
        const protocol = new RemoteTerminalProtocolServer({
            maxBufferedBytes: 512 * 1024,
            maxUnacknowledgedBytes: 256 * 1024,
            onInput() {},
            onResize() {},
        });
        protocol.attach(stream);
        socket.receive(
            encodeWirePacket({
                payload: Buffer.from(
                    JSON.stringify({
                        capabilities: { grid: true, vt: true },
                        clientId: "slow-websocket",
                        creditBytes: 256 * 1024,
                        parserFingerprint: "libghostty-vt/0.2/defaults",
                        resumeOutputOffset: 0,
                    }),
                ),
                sequence: 0,
                type: 1 as WirePacket["type"],
            }).data,
        );
        await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
        socket.finishSend();

        protocol.publishOutput(Buffer.alloc(1024 * 1024, 0x78));
        protocol.publishGrid({
            cols: 1,
            coversOutputOffset: 1024 * 1024,
            cursor: null,
            palette: [],
            rows: [{ cells: [], wrapped: false }],
            startRow: 0,
            styles: [{}],
            title: "bounded",
            totalRows: 1,
        });
        await vi.waitFor(() => expect(stream.metrics.pendingWriteBytes).toBeGreaterThan(0));

        expect(stream.metrics.pendingWriteBytes).toBeLessThanOrEqual(16 * 1024 + 20);
        expect(stream.writableLength).toBeLessThanOrEqual(256 * 1024);
        expect(socket.bufferedAmount).toBeLessThanOrEqual(16 * 1024 + 20);
        stream.destroy();
    });
});

class FakeBinaryWebSocket implements BinaryWebSocket {
    bufferedAmount = 0;
    closed = false;
    delaySends = false;
    readonly sent: Buffer[] = [];
    #handlers: BinaryWebSocketHandlers | undefined;
    #sendCallback: ((error?: Error) => void) | undefined;

    close(): void {
        this.closed = true;
    }

    disconnect(): void {
        this.#handlers?.close();
    }

    finishSend(): void {
        this.bufferedAmount = 0;
        const callback = this.#sendCallback;
        this.#sendCallback = undefined;
        callback?.();
    }

    pause(): void {}

    receive(data: Uint8Array): void {
        this.#handlers?.message(data);
    }

    resume(): void {}

    send(data: Uint8Array, callback: (error?: Error) => void): void {
        const packet = Buffer.from(data);
        this.sent.push(packet);
        this.bufferedAmount += packet.length;
        if (this.delaySends) this.#sendCallback = callback;
        else {
            this.bufferedAmount = 0;
            callback();
        }
    }

    subscribe(handlers: BinaryWebSocketHandlers): () => void {
        this.#handlers = handlers;
        return () => {
            if (this.#handlers === handlers) this.#handlers = undefined;
        };
    }
}
