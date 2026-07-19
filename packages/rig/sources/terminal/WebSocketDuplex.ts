import { Duplex } from "node:stream";

import type { BinaryWebSocket } from "./BinaryWebSocket.js";

export interface WebSocketDuplexMetrics {
    maxPendingWriteBytes: number;
    pendingWriteBytes: number;
}

export class WebSocketDuplex extends Duplex {
    readonly metrics: WebSocketDuplexMetrics = {
        maxPendingWriteBytes: 0,
        pendingWriteBytes: 0,
    };
    readonly #bufferedAmountLowWaterMark: number;
    #closed = false;
    #pendingWrite:
        | {
              callback: (error?: Error | null) => void;
              timer: ReturnType<typeof setTimeout> | undefined;
          }
        | undefined;
    readonly #socket: BinaryWebSocket;
    readonly #unsubscribe: () => void;

    constructor(
        socket: BinaryWebSocket,
        options: {
            bufferedAmountLowWaterMark?: number;
            readableHighWaterMark?: number;
            writableHighWaterMark?: number;
        } = {},
    ) {
        super({
            allowHalfOpen: false,
            readableHighWaterMark: options.readableHighWaterMark ?? 64 * 1024,
            writableHighWaterMark: options.writableHighWaterMark ?? 64 * 1024,
        });
        this.#socket = socket;
        this.#bufferedAmountLowWaterMark = options.bufferedAmountLowWaterMark ?? 32 * 1024;
        this.#unsubscribe = socket.subscribe({
            close: () => this.destroy(),
            error: (error) => this.destroy(error),
            message: (data) => {
                if (!this.destroyed && !this.push(Buffer.from(data))) this.#socket.pause?.();
            },
        });
    }

    override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        if (!this.#closed) {
            this.#closed = true;
            this.#unsubscribe();
            this.#socket.close();
        }
        const pending = this.#pendingWrite;
        this.#pendingWrite = undefined;
        if (pending !== undefined) {
            if (pending.timer !== undefined) clearTimeout(pending.timer);
            this.metrics.pendingWriteBytes = 0;
            pending.callback(error ?? new Error("Remote terminal WebSocket closed."));
        }
        callback(error);
    }

    override _read(): void {
        this.#socket.resume?.();
    }

    override _write(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
    ): void {
        if (this.#pendingWrite !== undefined) {
            callback(new Error("A remote terminal WebSocket write is already pending."));
            return;
        }
        const bytes = Buffer.from(chunk);
        this.metrics.pendingWriteBytes = bytes.length;
        this.metrics.maxPendingWriteBytes = Math.max(
            this.metrics.maxPendingWriteBytes,
            this.metrics.pendingWriteBytes,
        );
        this.#pendingWrite = { callback, timer: undefined };
        this.#socket.send(bytes, (error) => {
            if (error !== undefined) {
                this.#settleWrite(error);
                return;
            }
            this.#waitForBufferedAmount();
        });
    }

    #settleWrite(error?: Error): void {
        const pending = this.#pendingWrite;
        if (pending === undefined) return;
        this.#pendingWrite = undefined;
        if (pending.timer !== undefined) clearTimeout(pending.timer);
        this.metrics.pendingWriteBytes = 0;
        pending.callback(error);
    }

    #waitForBufferedAmount(): void {
        const pending = this.#pendingWrite;
        if (pending === undefined) return;
        if (this.#socket.bufferedAmount <= this.#bufferedAmountLowWaterMark) {
            this.#settleWrite();
            return;
        }
        pending.timer = setTimeout(() => this.#waitForBufferedAmount(), 1);
        pending.timer.unref?.();
    }
}
