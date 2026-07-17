export type RemoteTerminalStatus = "exited" | "running";

export type RemoteTerminalColor =
    | { kind: "palette"; index: number }
    | { kind: "rgb"; red: number; green: number; blue: number };

export type RemoteTerminalUnderline = "curly" | "dashed" | "dotted" | "double" | "none" | "single";

export interface RemoteTerminalStyle {
    background: RemoteTerminalColor | null;
    blink: boolean;
    bold: boolean;
    dim: boolean;
    foreground: RemoteTerminalColor | null;
    invisible: boolean;
    inverse: boolean;
    italic: boolean;
    overline: boolean;
    strikethrough: boolean;
    underline: RemoteTerminalUnderline;
    underlineColor: RemoteTerminalColor | null;
}

export interface RemoteTerminalCell {
    style: RemoteTerminalStyle;
    text: string;
    width: 1 | 2;
    x: number;
}

export interface RemoteTerminalRow {
    cells: readonly RemoteTerminalCell[];
    wrapped: boolean;
}

export interface RemoteTerminalCursor {
    blinking: boolean;
    shape: "bar" | "block" | "block_hollow" | "underline";
    visible: boolean;
    x: number;
    y: number;
}

export interface RemoteTerminalViewport {
    cols: number;
    cursor: RemoteTerminalCursor | null;
    cursorColor: RemoteTerminalColor | null;
    defaultBackground: RemoteTerminalColor;
    defaultForeground: RemoteTerminalColor;
    revision: number;
    palette: readonly RemoteTerminalColor[];
    rows: readonly RemoteTerminalRow[];
    startRow: number;
    title: string;
    totalRows: number;
}

export interface RemoteTerminalFrame extends RemoteTerminalViewport {
    exitCode: number | null;
    id: string;
    status: RemoteTerminalStatus;
}

export interface CreateRemoteTerminalRequest {
    cols?: number;
    command?: string;
    cwd?: string;
    maxScrollback?: number;
    rows?: number;
    shell?: string;
}

export interface CreateRemoteTerminalResponse {
    terminal: RemoteTerminalFrame;
}

export interface ListRemoteTerminalsResponse {
    terminals: readonly RemoteTerminalFrame[];
}

export interface ResizeRemoteTerminalRequest {
    cols: number;
    rows: number;
}

export interface WriteRemoteTerminalRequest {
    data: string;
}

export interface RemoteTerminalResponse {
    terminal: RemoteTerminalFrame;
}

export interface RemoteTerminalScrollbackResponse {
    viewport: RemoteTerminalViewport;
}

export interface WatchRemoteTerminalOptions {
    after?: number;
    onFrame: (frame: RemoteTerminalFrame) => void | Promise<void>;
    signal?: AbortSignal;
}
