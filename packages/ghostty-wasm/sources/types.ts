export type GhosttyColor =
    | { kind: "palette"; index: number }
    | { kind: "rgb"; red: number; green: number; blue: number };

export type GhosttyUnderline = "curly" | "dashed" | "dotted" | "double" | "none" | "single";

export interface GhosttyStyle {
    background: GhosttyColor | null;
    blink: boolean;
    bold: boolean;
    dim: boolean;
    foreground: GhosttyColor | null;
    invisible: boolean;
    inverse: boolean;
    italic: boolean;
    overline: boolean;
    strikethrough: boolean;
    underline: GhosttyUnderline;
    underlineColor: GhosttyColor | null;
}

export interface GhosttyCell {
    style: GhosttyStyle;
    text: string;
    width: 1 | 2;
    x: number;
}

export interface GhosttyRow {
    cells: readonly GhosttyCell[];
    wrapped: boolean;
}

export interface GhosttyCursor {
    blinking: boolean;
    shape: "bar" | "block" | "block_hollow" | "underline";
    visible: boolean;
    x: number;
    y: number;
}

export interface GhosttySnapshot {
    cols: number;
    cursor: GhosttyCursor | null;
    cursorColor: GhosttyColor | null;
    defaultBackground: GhosttyColor;
    defaultForeground: GhosttyColor;
    outputRevision: number;
    palette: readonly GhosttyColor[];
    rows: readonly GhosttyRow[];
    startRow: number;
    synchronizedOutputActive: boolean;
    title: string;
    totalRows: number;
    visibleRows: number;
}

export type GhosttyColorScheme = "dark" | "light";

export interface GhosttyOptions {
    colorScheme?: GhosttyColorScheme;
    cols?: number;
    maxScrollback?: number;
    rows?: number;
}

export type GhosttyWasmSource = ArrayBuffer;

export type GhosttyWasmLoader = () => GhosttyWasmSource | Promise<GhosttyWasmSource>;

export interface GhosttyLoadOptions extends GhosttyOptions {
    loadWasm?: GhosttyWasmLoader;
}
