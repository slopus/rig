import type { RemoteTerminalGridPatch, RemoteTerminalGridState } from "./types.js";

export function diffGridState(
    previous: RemoteTerminalGridState,
    next: RemoteTerminalGridState,
): RemoteTerminalGridPatch | undefined {
    if (
        previous.cols !== next.cols ||
        previous.rows.length !== next.rows.length ||
        previous.startRow !== next.startRow
    ) {
        return undefined;
    }
    const rows: [number, RemoteTerminalGridState["rows"][number]][] = [];
    for (let index = 0; index < next.rows.length; index += 1) {
        if (JSON.stringify(previous.rows[index]) !== JSON.stringify(next.rows[index])) {
            rows.push([index, next.rows[index]!]);
        }
    }
    return {
        baseRevision: previous.revision,
        cols: next.cols,
        coversOutputOffset: next.coversOutputOffset,
        cursor: next.cursor,
        palette: next.palette,
        revision: next.revision,
        rows,
        startRow: next.startRow,
        styles: next.styles,
        title: next.title,
        totalRows: next.totalRows,
    };
}
