import { TitleTracker } from "./title-tracker.js";
import { TerminalQueryTracker } from "./terminal-query-tracker.js";
import type {
    GhosttyCell,
    GhosttyColor,
    GhosttyColorScheme,
    GhosttyOptions,
    GhosttySnapshot,
    GhosttyStyle,
    GhosttyUnderline,
    GhosttyWasmSource,
} from "./types.js";
import { instantiateGhostty, type GhosttyExports } from "./wasm.js";

const textCapacity = 256;
const maximumPendingText = 1024 * 1024;
const retainedTextSuffix = 64;
const encoder = new TextEncoder();
const schemes = {
    dark: { background: 0x0d0d0d, foreground: 0xeeeeee },
    light: { background: 0xeeeeee, foreground: 0x0d0d0d },
} as const;

export class GhosttyTerminal {
    readonly #exports: GhosttyExports;
    readonly #pointer: number;
    readonly #queries = new TerminalQueryTracker();
    readonly #title = new TitleTracker();
    readonly #utf8Decoder = new TextDecoder();
    #disposed = false;
    #outputRevision = 0;
    #pendingText = "";
    #ptyWriteHandlers = new Set<(data: Uint8Array) => void>();

    private constructor(exports: GhosttyExports, pointer: number) {
        this.#exports = exports;
        this.#pointer = pointer;
    }

    static async create(
        source: GhosttyWasmSource,
        options: GhosttyOptions = {},
    ): Promise<GhosttyTerminal> {
        const exports = await instantiateGhostty(source);
        const pointer = exports.init(
            options.cols ?? 80,
            options.rows ?? 24,
            options.maxScrollback ?? 10_000,
        );
        if (pointer === 0)
            throw new Error("Ghostty could not initialize its WebAssembly terminal.");
        const terminal = new GhosttyTerminal(exports, pointer);
        terminal.#applyColorScheme(options.colorScheme ?? "dark");
        return terminal;
    }

    dispose(): void {
        if (this.#disposed) return;
        this.#pendingText += this.#utf8Decoder.decode();
        this.#flushPending();
        this.#disposed = true;
        this.#exports.deinit(this.#pointer);
    }

    onPtyWrite(handler: (data: Uint8Array) => void): () => void {
        this.#assertActive();
        this.#ptyWriteHandlers.add(handler);
        return () => this.#ptyWriteHandlers.delete(handler);
    }

    resize(cols: number, rows: number): void {
        this.#assertActive();
        this.#flushPending();
        this.#exports.resize(this.#pointer, cols, rows);
        this.#outputRevision += 1;
    }

    scrollBy(rows: number): void {
        this.#assertActive();
        this.#flushPending();
        this.#exports.scroll_by(this.#pointer, Math.trunc(rows));
    }

    scrollTo(row: number): void {
        this.#assertActive();
        this.#flushPending();
        this.#exports.scroll_to(this.#pointer, Math.max(0, Math.trunc(row)));
    }

    scrollToBottom(): void {
        this.#assertActive();
        this.#flushPending();
        this.#exports.scroll_bottom(this.#pointer);
    }

    scrollToTop(): void {
        this.#assertActive();
        this.#flushPending();
        this.#exports.scroll_top(this.#pointer);
    }

    setColorScheme(colorScheme: GhosttyColorScheme): void {
        this.#assertActive();
        this.#flushPending();
        this.#applyColorScheme(colorScheme);
        if (this.#exports.get_report_color_scheme(this.#pointer) !== 0) {
            this.#emitPtyWrite(colorScheme === "dark" ? "\x1b[?997;1n" : "\x1b[?997;2n");
        }
    }

    write(data: string | Uint8Array): void {
        this.#assertActive();
        const bytes = typeof data === "string" ? encoder.encode(data) : data;
        if (bytes.byteLength === 0) return;
        this.#pendingText += this.#utf8Decoder.decode(bytes, { stream: true });
        this.#title.observe(bytes);
        this.#outputRevision += 1;
        if (this.#pendingText.length > maximumPendingText) {
            const flushLength = this.#pendingText.length - retainedTextSuffix;
            this.#writeDirect(this.#pendingText.slice(0, flushLength));
            this.#pendingText = this.#pendingText.slice(flushLength);
        }
        const queries = this.#queries.observe(bytes);
        if (queries.length > 0) {
            this.#flushPending();
            this.#exports.update(this.#pointer);
            for (const query of queries) {
                if (query === "device-attributes") this.#emitPtyWrite("\x1b[?62;22c");
                else {
                    const slot = query === "foreground" ? 10 : 11;
                    const packed =
                        query === "foreground"
                            ? this.#exports.get_default_foreground(this.#pointer)
                            : this.#exports.get_default_background(this.#pointer);
                    this.#emitPtyWrite(colorResponse(slot, packed));
                }
            }
        }
    }

    snapshot(): GhosttySnapshot {
        this.#assertActive();
        this.#flushPending();
        return this.#snapshotCurrent();
    }

    snapshotPage(startRow: number, rowCount: number): GhosttySnapshot {
        this.#assertActive();
        this.#flushPending();
        const current = this.#snapshotCurrent();
        const requestedStart = Math.min(Math.max(0, Math.trunc(startRow)), current.totalRows);
        const requestedCount = Math.min(
            Math.max(0, Math.trunc(rowCount)),
            current.totalRows - requestedStart,
        );
        const requestedEnd = requestedStart + requestedCount;
        const cursorAbsoluteY = current.cursor ? current.startRow + current.cursor.y : null;
        const rows = [];
        try {
            let nextRow = requestedStart;
            while (nextRow < requestedEnd) {
                this.#exports.scroll_to(this.#pointer, nextRow);
                const page = this.#snapshotCurrent();
                const localStart = Math.max(0, nextRow - page.startRow);
                const availableEnd = Math.min(page.rows.length, requestedEnd - page.startRow);
                if (availableEnd <= localStart) break;
                rows.push(...page.rows.slice(localStart, availableEnd));
                nextRow = page.startRow + availableEnd;
            }
        } finally {
            this.#exports.scroll_to(this.#pointer, current.startRow);
        }
        const cursor =
            current.cursor &&
            cursorAbsoluteY !== null &&
            cursorAbsoluteY >= requestedStart &&
            cursorAbsoluteY < requestedEnd
                ? { ...current.cursor, y: cursorAbsoluteY - requestedStart }
                : null;
        return { ...current, cursor, rows, startRow: requestedStart };
    }

    #snapshotCurrent(): GhosttySnapshot {
        this.#exports.update(this.#pointer);
        const cols = this.#exports.get_cols(this.#pointer);
        const rowCount = this.#exports.get_rows(this.#pointer);
        const cellBytes = this.#exports.cell_bytes();
        const bufferLength = cols * rowCount * cellBytes;
        const bufferPointer = this.#exports.alloc_buffer(bufferLength);
        if (bufferPointer === 0) throw new Error("Ghostty could not allocate its viewport buffer.");

        try {
            this.#exports.get_viewport(this.#pointer, bufferPointer);
            const packedViewport = new Uint8Array(
                this.#exports.memory.buffer,
                bufferPointer,
                bufferLength,
            ).slice();
            const view = new DataView(packedViewport.buffer);
            const rows = Array.from({ length: rowCount }, (_, y) => ({
                cells: this.#readRow(view, y, cols, cellBytes),
                wrapped: this.#exports.get_row_wrapped(this.#pointer, y) !== 0,
            }));
            const totalRows = this.#exports.get_scroll_total(this.#pointer);
            return {
                cols,
                cursor: this.#readCursor(),
                cursorColor: this.#readCursorColor(),
                defaultBackground: rgbColor(this.#exports.get_default_background(this.#pointer)),
                defaultForeground: rgbColor(this.#exports.get_default_foreground(this.#pointer)),
                outputRevision: this.#outputRevision,
                palette: Array.from({ length: 256 }, (_, index) =>
                    rgbColor(this.#exports.get_palette_color(this.#pointer, index)),
                ),
                rows,
                startRow: this.#exports.get_scroll_offset(this.#pointer),
                synchronizedOutputActive:
                    this.#exports.get_synchronized_output(this.#pointer) !== 0,
                title: this.#title.title,
                totalRows,
                visibleRows: this.#exports.get_scroll_visible(this.#pointer),
            };
        } finally {
            this.#exports.free_buffer(bufferPointer, bufferLength);
        }
    }

    #assertActive(): void {
        if (this.#disposed) throw new Error("This Ghostty terminal has been disposed.");
    }

    #applyColorScheme(colorScheme: GhosttyColorScheme): void {
        const scheme = schemes[colorScheme];
        this.#exports.set_default_colors(this.#pointer, scheme.foreground, scheme.background);
    }

    #emitPtyWrite(response: string): void {
        const bytes = encoder.encode(response);
        for (const handler of this.#ptyWriteHandlers) handler(bytes);
    }

    #flushPending(): void {
        if (this.#pendingText.length === 0) return;
        this.#writeDirect(this.#pendingText);
        this.#pendingText = "";
    }

    #writeDirect(text: string): void {
        const bytes = encoder.encode(text);
        if (bytes.byteLength === 0) return;
        const dataPointer = this.#exports.alloc_buffer(bytes.byteLength);
        if (dataPointer === 0) throw new Error("Ghostty could not allocate its input buffer.");
        try {
            new Uint8Array(this.#exports.memory.buffer, dataPointer, bytes.byteLength).set(bytes);
            this.#exports.write(this.#pointer, dataPointer, bytes.byteLength);
        } finally {
            this.#exports.free_buffer(dataPointer, bytes.byteLength);
        }
    }

    #readCursor(): GhosttySnapshot["cursor"] {
        if (this.#exports.get_cursor_in_viewport(this.#pointer) === 0) return null;
        const shapes = ["bar", "block", "block_hollow", "underline"] as const;
        return {
            blinking: this.#exports.get_cursor_blinking(this.#pointer) !== 0,
            shape: shapes[this.#exports.get_cursor_shape(this.#pointer)] ?? "block",
            visible: this.#exports.get_cursor_visible(this.#pointer) !== 0,
            x: this.#exports.get_cursor_x(this.#pointer),
            y: this.#exports.get_cursor_y(this.#pointer),
        };
    }

    #readCursorColor(): GhosttyColor | null {
        const packed = this.#exports.get_cursor_color(this.#pointer);
        return packed < 0 ? null : rgbColor(packed);
    }

    #readRow(view: DataView, y: number, cols: number, cellBytes: number): readonly GhosttyCell[] {
        const cells: GhosttyCell[] = [];
        for (let x = 0; x < cols; x += 1) {
            const offset = (y * cols + x) * cellBytes;
            const width = view.getUint8(offset + 18);
            if (width === 0) continue;
            const text = this.#readText(y, x);
            const style = readStyle(view, offset);
            if (text.length === 0 && isDefaultStyle(style)) continue;
            cells.push({ style, text: text || " ", width: width === 2 ? 2 : 1, x });
        }
        return cells;
    }

    #readText(row: number, col: number): string {
        let capacity = textCapacity;
        let bufferPointer = this.#exports.alloc_buffer(capacity);
        if (bufferPointer === 0) throw new Error("Ghostty could not allocate its text buffer.");
        try {
            let length = this.#exports.get_cell_text(
                this.#pointer,
                row,
                col,
                bufferPointer,
                capacity,
            );
            if (length > capacity) {
                this.#exports.free_buffer(bufferPointer, capacity);
                bufferPointer = 0;
                capacity = length;
                bufferPointer = this.#exports.alloc_buffer(capacity);
                if (bufferPointer === 0)
                    throw new Error("Ghostty could not allocate its text buffer.");
                length = this.#exports.get_cell_text(
                    this.#pointer,
                    row,
                    col,
                    bufferPointer,
                    capacity,
                );
            }
            return new TextDecoder().decode(
                new Uint8Array(this.#exports.memory.buffer, bufferPointer, length),
            );
        } finally {
            if (bufferPointer !== 0) this.#exports.free_buffer(bufferPointer, capacity);
        }
    }
}

function isDefaultStyle(style: GhosttyStyle): boolean {
    return (
        style.background === null &&
        style.foreground === null &&
        style.underlineColor === null &&
        !style.blink &&
        !style.bold &&
        !style.dim &&
        !style.invisible &&
        !style.inverse &&
        !style.italic &&
        !style.overline &&
        !style.strikethrough &&
        style.underline === "none"
    );
}

function readColor(view: DataView, offset: number): GhosttyColor | null {
    const kind = view.getUint8(offset);
    if (kind === 1) return { kind: "palette", index: view.getUint8(offset + 1) };
    if (kind === 2) {
        return {
            blue: view.getUint8(offset + 3),
            green: view.getUint8(offset + 2),
            kind: "rgb",
            red: view.getUint8(offset + 1),
        };
    }
    return null;
}

function readStyle(view: DataView, offset: number): GhosttyStyle {
    const flags = view.getUint16(offset + 16, true);
    const contentTag = view.getUint8(offset + 19);
    const background =
        contentTag === 2
            ? { kind: "palette" as const, index: view.getUint8(offset + 20) }
            : contentTag === 3
              ? {
                    blue: view.getUint8(offset + 22),
                    green: view.getUint8(offset + 21),
                    kind: "rgb" as const,
                    red: view.getUint8(offset + 20),
                }
              : readColor(view, offset + 8);
    const underlines: readonly GhosttyUnderline[] = [
        "none",
        "single",
        "double",
        "curly",
        "dotted",
        "dashed",
    ];
    return {
        background,
        blink: (flags & (1 << 3)) !== 0,
        bold: (flags & (1 << 0)) !== 0,
        dim: (flags & (1 << 1)) !== 0,
        foreground: readColor(view, offset + 4),
        invisible: (flags & (1 << 5)) !== 0,
        inverse: (flags & (1 << 4)) !== 0,
        italic: (flags & (1 << 2)) !== 0,
        overline: (flags & (1 << 7)) !== 0,
        strikethrough: (flags & (1 << 6)) !== 0,
        underline: underlines[(flags >> 8) & 0x07] ?? "none",
        underlineColor: readColor(view, offset + 12),
    };
}

function rgbColor(packed: number): GhosttyColor {
    return {
        blue: packed & 0xff,
        green: (packed >> 8) & 0xff,
        kind: "rgb",
        red: (packed >> 16) & 0xff,
    };
}

function colorResponse(slot: 10 | 11, packed: number): string {
    const component = (shift: number) =>
        ((packed >> shift) & 0xff).toString(16).padStart(2, "0").repeat(2);
    return `\x1b]${slot};rgb:${component(16)}/${component(8)}/${component(0)}\x1b\\`;
}
