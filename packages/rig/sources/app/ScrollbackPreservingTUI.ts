import { TUI, visibleWidth, type Terminal } from "@earendil-works/pi-tui";

interface TuiRenderState {
    cursorRow: number;
    hardwareCursorRow: number;
    maxLinesRendered: number;
    previousHeight: number;
    previousKittyImageIds: Set<number>;
    previousLines: string[];
    previousViewportTop: number;
    previousWidth: number;
}

const BEGIN_SYNCHRONIZED_OUTPUT = "\x1b[?2026h";
const END_SYNCHRONIZED_OUTPUT = "\x1b[?2026l";

export class ScrollbackPreservingTUI extends TUI {
    constructor(terminal: Terminal, showHardwareCursor?: boolean) {
        super(terminal, showHardwareCursor);
    }

    preserveRenderedPrefix(lineCount: number): boolean {
        const state = this as unknown as TuiRenderState;
        if (state.previousLines.length === 0) return false;
        const prefixLineCount = Math.min(Math.max(0, lineCount), state.previousLines.length);

        const suffix = state.previousLines.slice(prefixLineCount);
        const suffixRows = suffix.reduce(
            (total, line) =>
                total + Math.max(1, Math.ceil(visibleWidth(line) / this.terminal.columns)),
            0,
        );
        const totalRows = state.previousLines.reduce(
            (total, line) =>
                total + Math.max(1, Math.ceil(visibleWidth(line) / this.terminal.columns)),
            0,
        );

        let output = BEGIN_SYNCHRONIZED_OUTPUT;
        // When the mutable tail fills the resized viewport, every committed row is
        // already above the live screen. Clear only that live screen; clearing the
        // terminal's scrollback would discard the committed transcript, while asking
        // the base renderer for a full redraw would replay it.
        if (suffixRows >= this.terminal.rows) {
            output += `\x1b[2J\x1b[H${END_SYNCHRONIZED_OUTPUT}`;
            this.terminal.write(output);

            state.previousLines = [];
            state.previousKittyImageIds = new Set();
            state.previousWidth = 0;
            state.previousHeight = 0;
            state.cursorRow = 0;
            state.hardwareCursorRow = 0;
            state.maxLinesRendered = 0;
            state.previousViewportTop = 0;
            return true;
        }

        if (totalRows >= this.terminal.rows) {
            output += "\x1b[999B\r";
        } else {
            const reflowed = state.previousLines.some(
                (line) => visibleWidth(line) > this.terminal.columns,
            );
            if (reflowed) return false;
            const rowsToEnd = Math.max(0, state.cursorRow - state.hardwareCursorRow);
            output += `\r${rowsToEnd > 0 ? `\x1b[${rowsToEnd}B` : ""}`;
        }
        for (let row = 0; row < suffixRows; row += 1) {
            output += "\x1b[2K";
            if (row < suffixRows - 1) output += "\x1b[1A";
        }
        // Move every committed row out of the addressable viewport. Later full-screen
        // redraws can then clear the live composer without erasing transcript history.
        output += `\x1b[J${"\r\n".repeat(Math.max(0, this.terminal.rows - 1))}${END_SYNCHRONIZED_OUTPUT}`;
        this.terminal.write(output);

        state.previousLines = [];
        state.previousKittyImageIds = new Set();
        state.previousWidth = 0;
        state.previousHeight = 0;
        state.cursorRow = 0;
        state.hardwareCursorRow = 0;
        state.maxLinesRendered = 0;
        state.previousViewportTop = 0;
        return true;
    }
}
