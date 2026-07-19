import {
    createGhosttyTerminal,
    type GhosttyColor,
    type GhosttySnapshot as WasmGhosttySnapshot,
    type GhosttyTerminal,
} from "@slopus/ghostty-wasm/node";
import type { GhosttySnapshot, GhosttyTerminalLike } from "@slopus/ghostty-web";

export class GhosttyWebTerminal implements GhosttyTerminalLike {
    readonly #terminal: GhosttyTerminal;

    private constructor(terminal: GhosttyTerminal) {
        this.#terminal = terminal;
    }

    static async create(options: {
        cols: number;
        maxScrollback: number;
        rows: number;
    }): Promise<GhosttyWebTerminal> {
        return new GhosttyWebTerminal(await createGhosttyTerminal(options));
    }

    close(): void {
        this.#terminal.dispose();
    }

    historyRevision(): number {
        return this.#terminal.snapshot().outputRevision;
    }

    onPtyWrite(handler: (data: string) => void): () => void {
        return this.#terminal.onPtyWrite((data) => handler(Buffer.from(data).toString("utf8")));
    }

    resize(cols: number, rows: number): void {
        this.#terminal.resize(cols, rows);
    }

    snapshot(): GhosttySnapshot {
        return adaptGhosttySnapshot(this.#terminal.snapshot());
    }

    snapshotPage(start: number, count: number): GhosttySnapshot {
        return adaptGhosttySnapshot(this.#terminal.snapshotPage(start, count));
    }

    writeBytes(data: Uint8Array): void {
        this.#terminal.write(data);
    }
}

function adaptGhosttySnapshot(snapshot: WasmGhosttySnapshot): GhosttySnapshot {
    return {
        cells: snapshot.rows.flatMap((row, y) =>
            row.cells.map((cell) => ({
                background: cell.style.background ?? snapshot.defaultBackground,
                blink: cell.style.blink,
                bold: cell.style.bold,
                dim: cell.style.dim,
                foreground: cell.style.foreground ?? snapshot.defaultForeground,
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
        ),
        cursor: snapshot.cursor ?? { visible: false, x: 0, y: 0 },
        palette: snapshot.palette.map(colorToCss),
        rows: snapshot.rows.map(rowText),
        scroll: {
            offset: snapshot.startRow,
            totalRows: snapshot.totalRows,
            visibleRows: snapshot.visibleRows,
        },
        title: snapshot.title,
        wrappedRows: snapshot.rows.map((row) => row.wrapped),
    };
}

function colorToCss(color: GhosttyColor): string {
    if (color.kind === "palette") return `palette:${color.index}`;
    return `#${hex(color.red)}${hex(color.green)}${hex(color.blue)}`;
}

function hex(value: number): string {
    return value.toString(16).padStart(2, "0");
}

function rowText(row: WasmGhosttySnapshot["rows"][number]): string {
    const cells = Array.from({ length: 1_000 }, () => " ");
    let width = 0;
    for (const cell of row.cells) {
        cells[cell.x] = cell.text;
        width = Math.max(width, cell.x + cell.width);
    }
    return cells.slice(0, width).join("").trimEnd();
}
