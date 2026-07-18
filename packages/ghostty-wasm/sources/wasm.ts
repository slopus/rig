import type { GhosttyWasmSource } from "./types.js";

export interface GhosttyExports {
    alloc_buffer(length: number): number;
    cell_bytes(): number;
    deinit(pointer: number): void;
    free_buffer(pointer: number, length: number): void;
    get_cell_text(
        pointer: number,
        row: number,
        col: number,
        bufferPointer: number,
        capacity: number,
    ): number;
    get_cols(pointer: number): number;
    get_cursor_blinking(pointer: number): number;
    get_cursor_color(pointer: number): number;
    get_cursor_in_viewport(pointer: number): number;
    get_cursor_shape(pointer: number): number;
    get_cursor_visible(pointer: number): number;
    get_cursor_x(pointer: number): number;
    get_cursor_y(pointer: number): number;
    get_default_background(pointer: number): number;
    get_default_foreground(pointer: number): number;
    get_palette_color(pointer: number, index: number): number;
    get_row_wrapped(pointer: number, row: number): number;
    get_report_color_scheme(pointer: number): number;
    get_rows(pointer: number): number;
    get_scroll_offset(pointer: number): number;
    get_scroll_total(pointer: number): number;
    get_scroll_visible(pointer: number): number;
    get_synchronized_output(pointer: number): number;
    get_viewport(pointer: number, bufferPointer: number): number;
    init(cols: number, rows: number, maxScrollback: number): number;
    memory: WebAssembly.Memory;
    resize(pointer: number, cols: number, rows: number): void;
    scroll_bottom(pointer: number): void;
    scroll_by(pointer: number, rows: number): void;
    scroll_to(pointer: number, row: number): void;
    scroll_top(pointer: number): void;
    set_default_colors(pointer: number, foreground: number, background: number): void;
    update(pointer: number): void;
    write(pointer: number, dataPointer: number, length: number): void;
}

export async function instantiateGhostty(source: GhosttyWasmSource): Promise<GhosttyExports> {
    const module = await WebAssembly.compile(source);
    const instance = await WebAssembly.instantiate(module, {});
    return instance.exports as unknown as GhosttyExports;
}
