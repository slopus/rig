import WebSocket, { type RawData } from "ws";

import type { BinaryWebSocket } from "./BinaryWebSocket.js";

export function createNodeBinaryWebSocket(webSocket: WebSocket): BinaryWebSocket {
    return {
        get bufferedAmount() {
            return webSocket.bufferedAmount;
        },
        close() {
            if (webSocket.readyState === WebSocket.OPEN) webSocket.close();
            else if (webSocket.readyState !== WebSocket.CLOSED) webSocket.terminate();
        },
        pause() {
            if (webSocket.readyState === WebSocket.OPEN) webSocket.pause();
        },
        resume() {
            if (webSocket.readyState === WebSocket.OPEN) webSocket.resume();
        },
        send(data, callback) {
            webSocket.send(data, { binary: true, compress: false }, callback);
        },
        subscribe(handlers) {
            const close = () => handlers.close();
            const error = (cause: Error) => handlers.error(cause);
            const message = (data: RawData, isBinary: boolean) => {
                if (!isBinary) {
                    handlers.error(new Error("Remote terminal WebSocket messages must be binary."));
                    return;
                }
                handlers.message(rawDataToBuffer(data));
            };
            webSocket.on("close", close);
            webSocket.on("error", error);
            webSocket.on("message", message);
            return () => {
                webSocket.off("close", close);
                webSocket.off("error", error);
                webSocket.off("message", message);
            };
        },
    };
}

function rawDataToBuffer(data: RawData): Buffer {
    if (Array.isArray(data)) return Buffer.concat(data);
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}
