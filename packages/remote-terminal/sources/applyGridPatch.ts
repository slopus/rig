import type { RemoteTerminalGridPatch, RemoteTerminalGridState } from "./types.js";

export function applyGridPatch(
    state: RemoteTerminalGridState,
    patch: RemoteTerminalGridPatch,
): RemoteTerminalGridState {
    if (state.revision !== patch.baseRevision)
        throw new Error("Grid patch base revision mismatch.");
    const rows = [...state.rows];
    for (const [index, row] of patch.rows) rows[index] = row;
    return {
        cols: patch.cols,
        coversOutputOffset: patch.coversOutputOffset,
        cursor: patch.cursor,
        palette: patch.palette,
        revision: patch.revision,
        rows,
        startRow: patch.startRow,
        styles: patch.styles,
        title: patch.title,
        totalRows: patch.totalRows,
    };
}
