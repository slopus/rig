import {
    createGhosttyTerminal,
    type GhosttyRow,
    type GhosttySnapshot,
    type GhosttyTerminal as WasmGhosttyTerminal,
} from "@slopus/ghostty-wasm/node";

import type { TerminalColorScheme, TerminalSnapshot } from "./types.js";

export class GhosttyTerminal {
    #bottomDepartureCount = 0;
    #closed = false;
    #cols: number;
    #lastAtBottom = true;
    #lastAtTop = false;
    #outputHandlers = new Set<(data: string) => void>();
    #outputRevision = 0;
    #rows: number;
    readonly #terminal: WasmGhosttyTerminal;
    #topArrivalCount = 0;

    private constructor(terminal: WasmGhosttyTerminal, cols: number, rows: number) {
        this.#terminal = terminal;
        this.#cols = cols;
        this.#rows = rows;
    }

    static async create(
        cols: number,
        rows: number,
        colorScheme: TerminalColorScheme = "dark",
    ): Promise<GhosttyTerminal> {
        const terminal = await createGhosttyTerminal({
            colorScheme,
            cols,
            maxScrollback: 10_000,
            rows,
        });
        return new GhosttyTerminal(terminal, cols, rows);
    }

    close(): void {
        if (this.#closed) return;
        this.#closed = true;
        this.#terminal.dispose();
    }

    resize(cols: number, rows: number): void {
        this.#assertActive();
        this.#terminal.resize(cols, rows);
        this.#cols = cols;
        this.#rows = rows;
        this.#observeScroll(this.#terminal.snapshot());
    }

    onPtyWrite(handler: (data: string) => void): () => void {
        return this.#terminal.onPtyWrite((data) => handler(Buffer.from(data).toString("utf8")));
    }

    onOutput(handler: (data: string) => void): () => void {
        this.#outputHandlers.add(handler);
        return () => this.#outputHandlers.delete(handler);
    }

    scrollBy(rows: number): void {
        this.#assertActive();
        this.#terminal.scrollBy(rows);
        this.#observeScroll(this.#terminal.snapshot());
    }

    scrollToBottom(): void {
        this.#assertActive();
        this.#terminal.scrollToBottom();
        this.#observeScroll(this.#terminal.snapshot());
    }

    scrollToTop(): void {
        this.#assertActive();
        this.#terminal.scrollToTop();
        this.#observeScroll(this.#terminal.snapshot());
    }

    setColorScheme(colorScheme: TerminalColorScheme): void {
        this.#assertActive();
        this.#terminal.setColorScheme(colorScheme);
    }

    snapshot(): Promise<TerminalSnapshot> {
        this.#assertActive();
        const current = this.#terminal.snapshot();
        this.#observeScroll(current);
        return Promise.resolve(this.#createSnapshot(current));
    }

    write(data: string): void {
        this.writeBytes(Buffer.from(data));
    }

    writeBytes(data: Uint8Array): void {
        this.#assertActive();
        this.#outputRevision += 1;
        const text = Buffer.from(data).toString("utf8");
        for (const handler of this.#outputHandlers) handler(text);
        this.#terminal.write(data);
    }

    #assertActive(): void {
        if (this.#closed) throw new Error("The Ghostty terminal is closed.");
    }

    #createSnapshot(current: GhosttySnapshot): TerminalSnapshot {
        const rows = current.rows.map((row) => rowText(row));
        const renderedCells = current.rows.flatMap((row, y) =>
            row.cells.map((cell) => ({
                background: cell.style.background,
                blink: cell.style.blink,
                bold: cell.style.bold,
                dim: cell.style.dim,
                foreground: cell.style.foreground,
                invisible: cell.style.invisible,
                inverse: cell.style.inverse,
                italic: cell.style.italic,
                overline: cell.style.overline,
                strikethrough: cell.style.strikethrough,
                text: cell.text,
                underline: cell.style.underline,
                underlineColor: cell.style.underlineColor,
                width: cell.width,
                x: cell.x,
                y,
            })),
        );
        const cells =
            renderedCells.length === this.#cols * this.#rows &&
            renderedCells.every((cell) => cell.text === " ")
                ? []
                : renderedCells;
        const atBottom = current.startRow + current.visibleRows >= current.totalRows;
        const atTop = current.totalRows > current.visibleRows && current.startRow === 0;
        return {
            cells,
            cursor: {
                visible: current.cursor?.visible ?? false,
                x: current.cursor?.x ?? 0,
                y: current.cursor?.y ?? 0,
            },
            defaultBackground: current.defaultBackground,
            defaultForeground: current.defaultForeground,
            outputRevision: this.#outputRevision,
            rows,
            scroll: {
                atBottom,
                atTop,
                bottomDepartureCount: this.#bottomDepartureCount,
                offset: current.startRow,
                topArrivalCount: this.#topArrivalCount,
                totalRows: current.totalRows,
                visibleRows: current.visibleRows,
            },
            synchronizedOutputActive: current.synchronizedOutputActive,
            text: rows.join("\n").trimEnd(),
            title: current.title,
            wrappedRows: current.rows.map((row) => row.wrapped),
        };
    }

    #observeScroll(snapshot: GhosttySnapshot): void {
        const atBottom = snapshot.startRow + snapshot.visibleRows >= snapshot.totalRows;
        const atTop = snapshot.totalRows > snapshot.visibleRows && snapshot.startRow === 0;
        if (this.#lastAtBottom && !atBottom) this.#bottomDepartureCount += 1;
        if (!this.#lastAtTop && atTop) this.#topArrivalCount += 1;
        this.#lastAtBottom = atBottom;
        this.#lastAtTop = atTop;
    }
}

function rowText(row: GhosttyRow): string {
    let result = "";
    let column = 0;
    for (const cell of row.cells) {
        result += " ".repeat(Math.max(0, cell.x - column));
        result += cell.text;
        column = cell.x + cell.width;
    }
    return result.trimEnd();
}
