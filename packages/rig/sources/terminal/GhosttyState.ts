import { createGhosttyTerminal, type GhosttyTerminal } from "@slopus/ghostty-wasm/node";

import type { RemoteTerminalViewport } from "./types.js";

interface HelperViewport extends Omit<RemoteTerminalViewport, "revision"> {
    requestId: number;
}

export class GhosttyState {
    #closed = false;
    #nextRequestId = 1;
    #rows: number;
    readonly #terminal: GhosttyTerminal;

    private constructor(terminal: GhosttyTerminal, rows: number) {
        this.#terminal = terminal;
        this.#rows = rows;
    }

    static async create(options: {
        cols: number;
        maxScrollback: number;
        rows: number;
    }): Promise<GhosttyState> {
        const terminal = await createGhosttyTerminal(options);
        return new GhosttyState(terminal, options.rows);
    }

    close(): void {
        if (this.#closed) return;
        this.#closed = true;
        this.#terminal.dispose();
    }

    onPtyWrite(handler: (data: Uint8Array) => void): () => void {
        return this.#terminal.onPtyWrite(handler);
    }

    resize(cols: number, rows: number): void {
        this.#assertActive();
        this.#rows = rows;
        this.#terminal.resize(cols, rows);
    }

    async snapshot(startRow?: number, rowCount?: number): Promise<HelperViewport> {
        this.#assertActive();
        const current = this.#terminal.snapshot();
        const requestedCount = Math.max(1, rowCount ?? this.#rows);
        const requestedStart = Math.min(
            startRow ?? Math.max(0, current.totalRows - requestedCount),
            current.totalRows,
        );
        const snapshot = this.#terminal.snapshotPage(requestedStart, requestedCount);
        return {
            cols: snapshot.cols,
            cursor: snapshot.cursor,
            cursorColor: snapshot.cursorColor,
            defaultBackground: snapshot.defaultBackground,
            defaultForeground: snapshot.defaultForeground,
            palette: snapshot.palette,
            requestId: this.#nextRequestId++,
            rows: snapshot.rows,
            startRow: snapshot.startRow,
            title: snapshot.title,
            totalRows: snapshot.totalRows,
        };
    }

    write(data: Uint8Array): void {
        this.#assertActive();
        this.#terminal.write(data);
    }

    #assertActive(): void {
        if (this.#closed) throw new Error("The terminal state is closed.");
    }
}
