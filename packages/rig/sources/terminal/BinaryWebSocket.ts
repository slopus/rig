export interface BinaryWebSocketHandlers {
    close: () => void;
    error: (error: Error) => void;
    message: (data: Uint8Array) => void;
}

export interface BinaryWebSocket {
    readonly bufferedAmount: number;
    close(): void;
    pause?(): void;
    resume?(): void;
    send(data: Uint8Array, callback: (error?: Error) => void): void;
    subscribe(handlers: BinaryWebSocketHandlers): () => void;
}
