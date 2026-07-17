import { createServer, type Server, Socket } from "node:net";

export interface ThrottledTcpProxyOptions {
    bytesPerSecond: number;
    jitterMs?: number;
    maxChunkBytes: number;
    oneWayLatencyMs: number;
    targetHost?: string;
    targetPort: number;
}

export class ThrottledTcpProxy {
    readonly #options: ThrottledTcpProxyOptions;
    #server: Server | undefined;
    readonly #sockets = new Set<Socket>();

    constructor(options: ThrottledTcpProxyOptions) {
        if (
            !Number.isFinite(options.bytesPerSecond) ||
            options.bytesPerSecond <= 0 ||
            !Number.isSafeInteger(options.maxChunkBytes) ||
            options.maxChunkBytes < 1 ||
            !Number.isFinite(options.oneWayLatencyMs) ||
            options.oneWayLatencyMs < 0 ||
            !Number.isFinite(options.jitterMs ?? 0) ||
            (options.jitterMs ?? 0) < 0
        ) {
            throw new Error("Invalid throttled TCP proxy options.");
        }
        this.#options = options;
    }

    async close(): Promise<void> {
        for (const socket of this.#sockets) socket.destroy();
        const server = this.#server;
        if (server === undefined) return;
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    async listen(): Promise<number> {
        if (this.#server !== undefined) throw new Error("The proxy is already listening.");
        const server = createServer((client) => {
            const upstream = new Socket();
            this.#sockets.add(client).add(upstream);
            client.once("close", () => this.#sockets.delete(client));
            upstream.once("close", () => this.#sockets.delete(upstream));
            upstream.connect(
                this.#options.targetPort,
                this.#options.targetHost ?? "127.0.0.1",
                () => {
                    forward(client, upstream, this.#options);
                    forward(upstream, client, this.#options);
                },
            );
            client.once("error", () => upstream.destroy());
            upstream.once("error", () => client.destroy());
        });
        this.#server = server;
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        if (address === null || typeof address === "string") throw new Error("Missing proxy port.");
        return address.port;
    }
}

function forward(source: Socket, destination: Socket, options: ThrottledTcpProxyOptions): void {
    const jitterMs = options.jitterMs ?? 0;
    let packet = 0;
    let nextAvailableAt = 0;
    let pendingChunks = 0;
    let sourceEnded = false;
    const finish = () => {
        if (sourceEnded && pendingChunks === 0 && !destination.destroyed) destination.end();
    };
    source.on("data", (data: Buffer) => {
        for (let offset = 0; offset < data.length; offset += options.maxChunkBytes) {
            const chunk = data.subarray(offset, offset + options.maxChunkBytes);
            const now = performance.now();
            const jitter = jitterMs === 0 ? 0 : (packet++ % 3) - 1;
            const readyAt = Math.max(
                now + options.oneWayLatencyMs + jitter * jitterMs,
                nextAvailableAt,
            );
            nextAvailableAt = readyAt + (chunk.length / options.bytesPerSecond) * 1_000;
            pendingChunks += 1;
            setTimeout(
                () => {
                    if (!destination.destroyed) destination.write(chunk);
                    pendingChunks -= 1;
                    finish();
                },
                Math.max(0, readyAt - now),
            ).unref();
        }
    });
    source.once("end", () => {
        sourceEnded = true;
        finish();
    });
}
