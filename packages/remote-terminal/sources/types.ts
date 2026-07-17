import type { Duplex } from "node:stream";

export type RemoteTerminalMode = "grid" | "vt";

export interface RemoteTerminalGridCell {
    styleId: number;
    text: string;
    width: 1 | 2;
    x: number;
}

export interface RemoteTerminalGridRow {
    cells: readonly RemoteTerminalGridCell[];
    wrapped: boolean;
}

export interface RemoteTerminalGridState {
    cols: number;
    coversOutputOffset: number;
    cursor: { visible: boolean; x: number; y: number } | null;
    palette: readonly string[];
    revision: number;
    rows: readonly RemoteTerminalGridRow[];
    startRow: number;
    styles: readonly Readonly<Record<string, unknown>>[];
    title: string;
    totalRows: number;
}

export interface RemoteTerminalGridPatch {
    baseRevision: number;
    cols: number;
    coversOutputOffset: number;
    cursor: RemoteTerminalGridState["cursor"];
    palette: readonly string[];
    revision: number;
    rows: readonly (readonly [number, RemoteTerminalGridRow])[];
    startRow: number;
    styles: RemoteTerminalGridState["styles"];
    title: string;
    totalRows: number;
}

export interface RemoteTerminalReplica {
    applyGrid(state: RemoteTerminalGridState): void | Promise<void>;
    applyVt(data: Uint8Array): void | Promise<void>;
    resize(cols: number, rows: number): void | Promise<void>;
}

export interface RemoteTerminalScrollbackPage {
    baseRow: number;
    count: number;
    historyEpoch: string;
    historyRevision: number;
    rows: readonly RemoteTerminalGridRow[];
    start: number;
    totalRows: number;
}

export interface RemoteTerminalServerOptions {
    epoch?: string;
    initialCols?: number;
    initialRows?: number;
    maxBufferedBytes?: number;
    maxInputLeases?: number;
    maxFrameBytes?: number;
    maxReplayBytes?: number;
    maxUnacknowledgedBytes?: number;
    onBeforeResize?: () => void | Promise<void>;
    onFlowControl?: (paused: boolean) => void;
    onInput: (data: Uint8Array) => void | Promise<void>;
    onResize: (cols: number, rows: number) => void | Promise<void>;
    onScrollback?: (
        start: number,
        count: number,
        basis?: { historyEpoch: string; historyRevision: number },
    ) => RemoteTerminalScrollbackPage | Promise<RemoteTerminalScrollbackPage>;
    parserFingerprint?: string;
    wireChunkBytes?: number;
}

export interface RemoteTerminalClientOptions {
    capabilities?: { grid: boolean; vt: boolean };
    clientId: string;
    creditBytes?: number;
    epoch?: string;
    inputLease?: string;
    pendingInputs?: readonly { data: Uint8Array; sequence: number }[];
    onExit?: (exitCode: number | null) => void;
    onMode?: (mode: RemoteTerminalMode) => void;
    parserFingerprint?: string;
    replica: RemoteTerminalReplica;
    resumeInputSequence?: number;
    resumeOutputOffset?: number;
    stream: Duplex;
}

export interface RemoteTerminalProtocolMetrics {
    compressedPackets: number;
    encodedPackets: number;
    payloadBytes: number;
    wireBytes: number;
}
