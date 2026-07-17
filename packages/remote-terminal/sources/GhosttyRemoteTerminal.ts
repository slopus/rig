import { RemoteTerminalProtocolServer } from "./RemoteTerminalProtocolServer.js";
import type {
    RemoteTerminalGridRow,
    RemoteTerminalGridState,
    RemoteTerminalReplica,
    RemoteTerminalServerOptions,
} from "./types.js";

export interface GhosttySnapshotCell {
    background: unknown;
    blink?: boolean;
    bold: boolean;
    dim: boolean;
    foreground: unknown;
    invisible?: boolean;
    inverse?: boolean;
    italic: boolean;
    overline?: boolean;
    strikethrough?: boolean;
    text: string;
    underline?: string;
    underlineColor?: unknown;
    width?: 1 | 2;
    x: number;
    y: number;
}

export interface GhosttySnapshot {
    cells: readonly GhosttySnapshotCell[];
    cursor: { visible: boolean; x: number; y: number };
    palette?: readonly string[];
    rows: readonly string[];
    scroll: { offset: number; totalRows: number; visibleRows: number };
    title: string;
    wrappedRows?: readonly boolean[];
}

export interface GhosttyTerminalLike {
    onPtyWrite?(handler: (data: string) => void): () => void;
    resize(cols: number, rows: number): void | Promise<void>;
    snapshot(): GhosttySnapshot | Promise<GhosttySnapshot>;
    writeBytes(data: Uint8Array): void | Promise<void>;
}

export class GhosttyRemoteTerminalReplica implements RemoteTerminalReplica {
    readonly #terminal: GhosttyTerminalLike;

    constructor(terminal: GhosttyTerminalLike) {
        this.#terminal = terminal;
    }

    applyGrid(): never {
        throw new Error("A Ghostty VT replica cannot be seeded from a semantic grid.");
    }

    applyVt(data: Uint8Array): void | Promise<void> {
        return this.#terminal.writeBytes(data);
    }

    resize(cols: number, rows: number): void | Promise<void> {
        return this.#terminal.resize(cols, rows);
    }
}

export class GhosttyRemoteTerminalServerDriver {
    #cols: number;
    #exiting = false;
    readonly #heldOutput: {
        bytes: Buffer;
        reject: (error: unknown) => void;
        resolve: () => void;
    }[] = [];
    #heldOutputBytes = 0;
    readonly #maxBufferedBytes: number;
    #operation = Promise.resolve();
    #queuedOutputBytes = 0;
    readonly #protocol: RemoteTerminalProtocolServer;
    readonly #terminal: GhosttyTerminalLike;
    readonly #unsubscribePtyWrite: (() => void) | undefined;
    #waitingForResize = false;

    constructor(
        protocol: RemoteTerminalProtocolServer,
        terminal: GhosttyTerminalLike,
        cols = 80,
        maxBufferedBytes = 4 * 1024 * 1024,
        onTerminalResponse?: (data: Uint8Array) => void | Promise<void>,
    ) {
        this.#protocol = protocol;
        this.#terminal = terminal;
        this.#cols = cols;
        this.#maxBufferedBytes = maxBufferedBytes;
        this.#unsubscribePtyWrite =
            onTerminalResponse === undefined
                ? undefined
                : terminal.onPtyWrite?.((data) => {
                      try {
                          void Promise.resolve(onTerminalResponse(Buffer.from(data))).catch(
                              (error: unknown) => this.#protocol.fail(error),
                          );
                      } catch (error) {
                          this.#protocol.fail(error);
                      }
                  });
    }

    publishOutput(data: Uint8Array): Promise<void> {
        if (this.#exiting) return Promise.reject(new Error("Terminal output has already exited."));
        const bytes = Buffer.from(data);
        if (this.#queuedOutputBytes + bytes.length > this.#maxBufferedBytes) {
            const error = new Error("Canonical terminal output buffer is full.");
            this.#protocol.fail(error);
            return Promise.reject(error);
        }
        this.#queuedOutputBytes += bytes.length;
        if (this.#waitingForResize) {
            if (this.#heldOutputBytes + bytes.length > this.#maxBufferedBytes) {
                const error = new Error("Canonical resize output buffer is full.");
                this.#queuedOutputBytes -= bytes.length;
                this.#protocol.fail(error);
                return Promise.reject(error);
            }
            this.#heldOutputBytes += bytes.length;
            return new Promise((resolve, reject) => {
                this.#heldOutput.push({ bytes, reject, resolve });
            });
        }
        return this.#enqueueOutput(bytes, true);
    }

    async prepareResize(): Promise<void> {
        if (this.#waitingForResize)
            throw new Error("A canonical terminal resize is already pending.");
        this.#waitingForResize = true;
        await this.#operation;
    }

    async performResize(
        cols: number,
        rows: number,
        resizePty?: (cols: number, rows: number) => void | Promise<void>,
    ): Promise<void> {
        if (!this.#waitingForResize) throw new Error("Canonical resize was not prepared.");
        let failure: unknown;
        try {
            await resizePty?.(cols, rows);
            await this.#terminal.resize(cols, rows);
            this.#cols = cols;
            const snapshot = await this.#terminal.snapshot();
            this.#protocol.publishGrid({
                ...ghosttySnapshotToGrid(snapshot, this.#cols),
                coversOutputOffset: this.#protocol.outputOffset(),
            });
        } catch (error) {
            failure = error;
            this.#protocol.fail(error);
            throw error;
        } finally {
            this.#waitingForResize = false;
            for (const held of this.#heldOutput.splice(0)) {
                this.#heldOutputBytes -= held.bytes.length;
                if (failure === undefined)
                    void this.#enqueueOutput(held.bytes, true).then(held.resolve, held.reject);
                else {
                    this.#queuedOutputBytes -= held.bytes.length;
                    held.reject(failure);
                }
            }
        }
    }

    async publishExit(exitCode: number | null): Promise<void> {
        if (this.#waitingForResize)
            throw new Error("Cannot exit while a terminal resize is pending.");
        this.#exiting = true;
        await this.#operation;
        this.#protocol.publishExit(exitCode);
    }

    close(): void {
        this.#unsubscribePtyWrite?.();
    }

    settled(): Promise<void> {
        return this.#operation;
    }

    #enqueueOutput(bytes: Buffer, reserved = false): Promise<void> {
        if (!reserved) this.#queuedOutputBytes += bytes.length;
        const operation = this.#operation.then(async () => {
            try {
                await this.#terminal.writeBytes(bytes);
                const snapshot = await this.#terminal.snapshot();
                this.#protocol.publishUpdate(bytes, ghosttySnapshotToGrid(snapshot, this.#cols));
            } finally {
                this.#queuedOutputBytes -= bytes.length;
            }
        });
        this.#operation = operation.catch((error: unknown) => {
            this.#protocol.fail(error);
        });
        return operation;
    }
}

export function createGhosttyRemoteTerminalServer(
    terminal: GhosttyTerminalLike,
    options: Omit<RemoteTerminalServerOptions, "onResize"> & {
        onResize?: RemoteTerminalServerOptions["onResize"];
        onTerminalResponse?: (data: Uint8Array) => void | Promise<void>;
    },
): { driver: GhosttyRemoteTerminalServerDriver; protocol: RemoteTerminalProtocolServer } {
    let driver!: GhosttyRemoteTerminalServerDriver;
    const protocol = new RemoteTerminalProtocolServer({
        ...options,
        async onBeforeResize() {
            await options.onBeforeResize?.();
            await driver.prepareResize();
        },
        async onResize(cols, rows) {
            await driver.performResize(cols, rows, options.onResize);
        },
    });
    driver = new GhosttyRemoteTerminalServerDriver(
        protocol,
        terminal,
        options.initialCols ?? 80,
        options.maxBufferedBytes ?? options.maxReplayBytes ?? 4 * 1024 * 1024,
        options.onTerminalResponse,
    );
    return { driver, protocol };
}

export function ghosttySnapshotToGrid(
    snapshot: GhosttySnapshot,
    cols = Math.max(
        1,
        snapshot.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0),
    ),
): Omit<RemoteTerminalGridState, "coversOutputOffset" | "revision"> {
    const styleIds = new Map<string, number>();
    const styles: Readonly<Record<string, unknown>>[] = [];
    const cellsByRow = new Map<number, GhosttySnapshotCell[]>();
    for (const cell of snapshot.cells) {
        const row = cellsByRow.get(cell.y) ?? [];
        row.push(cell);
        cellsByRow.set(cell.y, row);
    }
    const rows: RemoteTerminalGridRow[] = snapshot.rows.map((_text, y) => {
        const source = (cellsByRow.get(y) ?? []).sort((left, right) => left.x - right.x);
        return {
            cells: source.map((cell, index) => {
                const style = {
                    background: cell.background,
                    blink: cell.blink ?? false,
                    bold: cell.bold,
                    dim: cell.dim,
                    foreground: cell.foreground,
                    invisible: cell.invisible ?? false,
                    inverse: cell.inverse ?? false,
                    italic: cell.italic,
                    overline: cell.overline ?? false,
                    strikethrough: cell.strikethrough ?? false,
                    underline: cell.underline ?? "none",
                    underlineColor: cell.underlineColor ?? null,
                };
                const key = JSON.stringify(style);
                let styleId = styleIds.get(key);
                if (styleId === undefined) {
                    styleId = styles.length;
                    styleIds.set(key, styleId);
                    styles.push(style);
                }
                const nextX = source[index + 1]?.x;
                const width: 1 | 2 = cell.width ?? (nextX === cell.x + 2 ? 2 : 1);
                return { styleId, text: cell.text, width, x: cell.x };
            }),
            wrapped: snapshot.wrappedRows?.[y] ?? false,
        };
    });
    return {
        cols,
        cursor: snapshot.cursor,
        palette: snapshot.palette ?? [],
        rows,
        startRow: snapshot.scroll.offset,
        styles: styles.length === 0 ? [{}] : styles,
        title: snapshot.title,
        totalRows: snapshot.scroll.totalRows,
    };
}
