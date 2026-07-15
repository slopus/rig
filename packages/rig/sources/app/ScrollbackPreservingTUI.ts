import { TUI, type Terminal } from "@earendil-works/pi-tui";

import { ScrollbackPreservingTerminal } from "./ScrollbackPreservingTerminal.js";

interface TuiRenderState {
    applyLineResets(lines: string[]): string[];
    collectKittyImageIds(lines: readonly string[]): Set<number>;
    compositeOverlays(lines: string[], width: number, height: number): string[];
    cursorRow: number;
    extractCursorPosition(lines: string[], height: number): unknown;
    hardwareCursorRow: number;
    maxLinesRendered: number;
    overlayStack: readonly unknown[];
    previousHeight: number;
    previousKittyImageIds: Set<number>;
    previousLines: string[];
    previousViewportTop: number;
    previousWidth: number;
}

interface ResizeLiveTailComponent {
    resizeLiveTailLineCount(width: number): number;
}

interface TerminalResizeComponent {
    beginTerminalResize(): void;
    endTerminalResize(): void;
}

export class ScrollbackPreservingTUI extends TUI {
    #forceRenderAfterResize = false;
    #resizePending = false;

    constructor(terminal: Terminal, showHardwareCursor?: boolean) {
        super(terminal, showHardwareCursor);
    }

    override requestRender(force = false): void {
        if (this.terminal instanceof ScrollbackPreservingTerminal && this.terminal.resizePending) {
            if (!this.#resizePending) {
                this.#resizePending = true;
                for (const child of this.children) {
                    if (isTerminalResizeComponent(child)) child.beginTerminalResize();
                }
            }
            this.#forceRenderAfterResize ||= force;
            return;
        }
        const resized = this.#prepareLiveTailAfterResize();
        if (this.#resizePending) {
            this.#resizePending = false;
            for (const child of this.children) {
                if (isTerminalResizeComponent(child)) child.endTerminalResize();
            }
        }
        const shouldForce = force || this.#forceRenderAfterResize;
        this.#forceRenderAfterResize = false;
        if (shouldForce && !resized) this.terminal.write("\x1b[0m");
        super.requestRender(shouldForce && !resized);
    }

    #prepareLiveTailAfterResize(): boolean {
        const state = this as unknown as TuiRenderState;
        const width = this.terminal.columns;
        const height = this.terminal.rows;
        if (
            state.previousLines.length === 0 ||
            (state.previousWidth === width && state.previousHeight === height)
        ) {
            return false;
        }

        const previousLiveTailLineCount = this.#liveTailLineCount(state.previousWidth);
        let lines = this.render(width);
        if (state.overlayStack.length > 0) {
            lines = state.compositeOverlays(lines, width, height);
        }
        state.extractCursorPosition(lines, height);
        lines = state.applyLineResets(lines);

        const liveTailLineCount = Math.min(height, this.#liveTailLineCount());
        const liveTailLines = lines.slice(lines.length - liveTailLineCount);
        const liveTailStart = height - liveTailLineCount;
        const repaintRows = new Set<number>();
        const repaintTopViewport = state.previousViewportTop === 0 && lines.length <= height;
        if (repaintTopViewport) {
            for (let row = 0; row < height; row += 1) {
                repaintRows.add(row);
            }
        } else {
            const previousLiveTailStart = Math.max(
                0,
                state.previousHeight - previousLiveTailLineCount,
            );
            for (
                let row = previousLiveTailStart;
                row < Math.min(state.previousHeight, height);
                row += 1
            ) {
                repaintRows.add(row);
            }
            for (let row = liveTailStart; row < height; row += 1) repaintRows.add(row);
        }
        let output = "\x1b[?2026h";
        for (const row of [...repaintRows].sort((left, right) => left - right)) {
            const line = repaintTopViewport
                ? (lines[row] ?? "")
                : row < liveTailStart
                  ? ""
                  : (liveTailLines[row - liveTailStart] ?? "");
            output += `\x1b[${row + 1};1H\x1b[2K${line}`;
        }
        output += `\x1b[${height};1H`;
        output += "\x1b[?2026l";
        this.terminal.write(output);

        const viewportTop = Math.max(0, lines.length - height);
        const finalRow = Math.max(0, lines.length - 1);
        state.previousLines = lines;
        state.previousKittyImageIds = state.collectKittyImageIds(lines);
        state.previousWidth = width;
        state.previousHeight = height;
        state.cursorRow = finalRow;
        state.hardwareCursorRow = finalRow;
        state.maxLinesRendered = lines.length;
        state.previousViewportTop = viewportTop;
        return true;
    }

    #liveTailLineCount(width = this.terminal.columns): number {
        return this.children.reduce(
            (total, child) =>
                total +
                (isResizeLiveTailComponent(child)
                    ? child.resizeLiveTailLineCount(width)
                    : this.terminal.rows),
            0,
        );
    }
}

function isResizeLiveTailComponent(component: unknown): component is ResizeLiveTailComponent {
    return (
        typeof component === "object" &&
        component !== null &&
        "resizeLiveTailLineCount" in component &&
        typeof component.resizeLiveTailLineCount === "function"
    );
}

function isTerminalResizeComponent(component: unknown): component is TerminalResizeComponent {
    return (
        typeof component === "object" &&
        component !== null &&
        "beginTerminalResize" in component &&
        typeof component.beginTerminalResize === "function" &&
        "endTerminalResize" in component &&
        typeof component.endTerminalResize === "function"
    );
}
