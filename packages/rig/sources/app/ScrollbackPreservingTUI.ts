import { TUI, type Terminal } from "@earendil-works/pi-tui";

import { ScrollbackPreservingTerminal } from "./ScrollbackPreservingTerminal.js";

// Cursor reports are ANSI escape sequences, so matching the control byte is intentional.
// eslint-disable-next-line no-control-regex
const CURSOR_REPORT_PATTERN = /\x1b\[(\d+);\d+R/u;
const CURSOR_REPORT_TIMEOUT_MS = 200;

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
    renderRequested: boolean;
    renderTimer: NodeJS.Timeout | undefined;
}

interface ResizeLiveTailComponent {
    resizeLiveTailLineCount(width: number): number;
}

interface TerminalResizeComponent {
    beginTerminalResize(): void;
    endTerminalResize(): void;
}

type CursorProbeSupport = "unknown" | "supported" | "unsupported";

export class ScrollbackPreservingTUI extends TUI {
    #activeCursorProbeGeneration: number | undefined;
    #bottomAnchorLineCount = 0;
    #cursorProbeGeneration = 0;
    #cursorProbeSupport: CursorProbeSupport = "unknown";
    #forceRenderAfterResize = false;
    readonly #issuedCursorProbeGenerations: number[] = [];
    #measuredCursorRow: number | undefined;
    #paintedLiveTailLineCount = 0;
    #probeTimer: NodeJS.Timeout | undefined;
    #resizePending = false;

    constructor(terminal: Terminal, showHardwareCursor?: boolean) {
        super(terminal, showHardwareCursor);
        this.addInputListener((data) => this.#consumeCursorReports(data));
    }

    override render(width: number): string[] {
        const lines = super.render(width);
        this.#paintedLiveTailLineCount = Math.min(
            this.terminal.rows,
            this.#liveTailLineCount(width, this.terminal.rows),
        );
        if (lines.length >= this.#bottomAnchorLineCount) return lines;
        return [...Array<string>(this.#bottomAnchorLineCount - lines.length).fill(""), ...lines];
    }

    override requestRender(force = false): void {
        if (this.terminal instanceof ScrollbackPreservingTerminal && this.terminal.resizePending) {
            if (!this.#resizePending) {
                this.#resizePending = true;
                const state = this as unknown as TuiRenderState;
                if (state.renderTimer !== undefined) clearTimeout(state.renderTimer);
                state.renderTimer = undefined;
                state.renderRequested = false;
                for (const child of this.children) {
                    if (isTerminalResizeComponent(child)) child.beginTerminalResize();
                }
            }
            this.#abortCursorProbe();
            this.#forceRenderAfterResize ||= force;
            return;
        }
        if (this.#probeTimer !== undefined) {
            this.#forceRenderAfterResize ||= force;
            return;
        }
        if (this.#shouldProbeCursor()) {
            this.#forceRenderAfterResize ||= force;
            this.#beginCursorProbe();
            return;
        }
        this.#completeRender(force);
    }

    override stop(): void {
        this.#abortCursorProbe();
        this.#issuedCursorProbeGenerations.length = 0;
        super.stop();
    }

    #shouldProbeCursor(): boolean {
        const state = this as unknown as TuiRenderState;
        const widthChanged = state.previousWidth !== this.terminal.columns;
        const heightChanged = state.previousHeight !== this.terminal.rows;
        return (
            this.#cursorProbeSupport !== "unsupported" &&
            state.previousLines.length > 0 &&
            widthChanged !== heightChanged
        );
    }

    // Emulators disagree about what a resize does to the rows already on screen. Vertical
    // growth may pull history back into view, while width reflow may move hard-positioned
    // live-tail rows independently of the stable transcript. The cursor rides along with
    // the painted content, so its actual row reveals how far those rows moved.
    #beginCursorProbe(): void {
        const state = this as unknown as TuiRenderState;
        const widthChanged = state.previousWidth !== this.terminal.columns;
        const timeoutMs = widthChanged && !this.#resizePending ? 0 : CURSOR_REPORT_TIMEOUT_MS;
        const generation = (this.#cursorProbeGeneration += 1);
        this.#activeCursorProbeGeneration = generation;
        this.#issuedCursorProbeGenerations.push(generation);
        this.#measuredCursorRow = undefined;
        this.terminal.write("\x1b[6n");
        this.#probeTimer = setTimeout(() => {
            if (this.#activeCursorProbeGeneration !== generation) return;
            this.#probeTimer = undefined;
            this.#activeCursorProbeGeneration = undefined;
            this.#issuedCursorProbeGenerations.length = 0;
            if (this.#cursorProbeSupport === "unknown") {
                this.#cursorProbeSupport = "unsupported";
            }
            this.#completeRender(false);
        }, timeoutMs);
    }

    #abortCursorProbe(): void {
        if (this.#probeTimer !== undefined) clearTimeout(this.#probeTimer);
        this.#probeTimer = undefined;
        this.#activeCursorProbeGeneration = undefined;
        this.#measuredCursorRow = undefined;
    }

    #consumeCursorReports(data: string): { consume: true } | { data: string } | undefined {
        if (this.#issuedCursorProbeGenerations.length === 0) return undefined;
        let remaining = data;
        let match = CURSOR_REPORT_PATTERN.exec(remaining);
        let measuredCursorRow: number | undefined;
        while (this.#issuedCursorProbeGenerations.length > 0 && match !== null) {
            const generation = this.#issuedCursorProbeGenerations.shift();
            this.#cursorProbeSupport = "supported";
            if (generation === this.#activeCursorProbeGeneration) {
                measuredCursorRow = Number.parseInt(match[1] ?? "1", 10) - 1;
                this.#activeCursorProbeGeneration = undefined;
            }
            remaining =
                remaining.slice(0, match.index) + remaining.slice(match.index + match[0].length);
            match = CURSOR_REPORT_PATTERN.exec(remaining);
        }
        if (remaining === data) return undefined;
        if (measuredCursorRow !== undefined) {
            clearTimeout(this.#probeTimer);
            this.#probeTimer = undefined;
            this.#measuredCursorRow = measuredCursorRow;
            this.#issuedCursorProbeGenerations.length = 0;
            this.#completeRender(false);
        }
        return remaining.length === 0 ? { consume: true } : { data: remaining };
    }

    #takeMeasuredCursorRow(): number | undefined {
        const row = this.#measuredCursorRow;
        this.#measuredCursorRow = undefined;
        return row;
    }

    #completeRender(force: boolean): void {
        this.#issuedCursorProbeGenerations.length = 0;
        const resized = this.#prepareLiveTailAfterResize(this.#takeMeasuredCursorRow());
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

    #prepareLiveTailAfterResize(measuredCursorRow: number | undefined): boolean {
        const state = this as unknown as TuiRenderState;
        const width = this.terminal.columns;
        const height = this.terminal.rows;
        if (
            state.previousLines.length === 0 ||
            (state.previousWidth === width && state.previousHeight === height)
        ) {
            return false;
        }

        const previousLiveTailLineCount = this.#paintedLiveTailLineCount;
        let lines = this.render(width);
        if (state.overlayStack.length > 0) {
            lines = state.compositeOverlays(lines, width, height);
        }
        state.extractCursorPosition(lines, height);
        lines = state.applyLineResets(lines);

        const liveTailLineCount = Math.min(height, this.#liveTailLineCount(width, height));
        const liveTailLines = lines.slice(lines.length - liveTailLineCount);
        const widthChanged = state.previousWidth !== width;
        if (widthChanged && lines.length < height && state.previousViewportTop > 0) {
            this.#bottomAnchorLineCount = height;
            const padding = state.applyLineResets(Array<string>(height - lines.length).fill(""));
            lines = [...padding, ...lines];
        }
        const finalRow = Math.max(0, lines.length - 1);
        const expectedCursorRow = clamp(
            state.hardwareCursorRow - state.previousViewportTop,
            0,
            Math.max(0, state.previousHeight - 1),
        );
        const measuredRowShift =
            measuredCursorRow === undefined ? 0 : measuredCursorRow - expectedCursorRow;
        const liveTailShrankAtSameHeight =
            state.previousHeight === height && previousLiveTailLineCount > liveTailLineCount;
        const liveTailRowShift =
            widthChanged && !liveTailShrankAtSameHeight ? 0 : measuredRowShift;
        let viewportTop: number;
        let output = "\x1b[?2026h";
        if (widthChanged) {
            // History has reflowed at the new width, so stable rows cannot be repainted
            // without duplicating scrollback; adopt the terminal's reflow and redraw only
            // the live tail unless the entire source still fits a never-scrolled screen.
            const bottomViewportTop = Math.max(0, lines.length - height);
            viewportTop = bottomViewportTop;
            if (lines.length <= height && state.previousViewportTop === 0) {
                for (let row = 0; row < height; row += 1) {
                    output += `\x1b[${row + 1};1H\x1b[2K${lines[row] ?? ""}`;
                }
            } else {
                const previousLiveTailStart = Math.max(
                    0,
                    state.previousHeight - previousLiveTailLineCount + liveTailRowShift,
                );
                const liveTailStart = lines.length - liveTailLineCount - viewportTop;
                const repaintLines = new Map<number, string>();
                const revealedStableStart = Math.min(
                    previousLiveTailStart,
                    Math.max(0, state.previousHeight - previousLiveTailLineCount),
                );
                const reanchorShrunkenTail =
                    measuredCursorRow !== undefined &&
                    this.#resizePending &&
                    liveTailShrankAtSameHeight &&
                    revealedStableStart < liveTailStart;
                if (reanchorShrunkenTail) {
                    for (let row = 0; row < height; row += 1) {
                        repaintLines.set(row, lines[viewportTop + row] ?? "");
                    }
                } else {
                    for (
                        let row = previousLiveTailStart;
                        row < Math.min(state.previousHeight, height);
                        row += 1
                    ) {
                        repaintLines.set(row, "");
                    }
                    for (let row = liveTailStart; row < height; row += 1) {
                        repaintLines.set(row, liveTailLines[row - liveTailStart] ?? "");
                    }
                }
                for (const [row, line] of [...repaintLines].sort(
                    ([left], [right]) => left - right,
                )) {
                    output += `\x1b[${row + 1};1H\x1b[2K${line}`;
                }
            }
        } else {
            // Pure vertical resize. The cursor probe tells us how far the emulator moved
            // the rows we previously painted, so the transcript stays exactly where the
            // emulator put it and only the live tail is repainted at its true position.
            const alignedViewportTop = state.previousViewportTop - measuredRowShift;
            viewportTop = clamp(
                alignedViewportTop,
                Math.max(0, lines.length - height),
                Math.max(0, lines.length - liveTailLineCount),
            );
            const repaintFrom =
                viewportTop === alignedViewportTop
                    ? Math.max(0, lines.length - liveTailLineCount - viewportTop)
                    : 0;
            for (let row = repaintFrom; row < height; row += 1) {
                output += `\x1b[${row + 1};1H\x1b[2K${lines[viewportTop + row] ?? ""}`;
            }
        }
        const finalScreenRow = clamp(finalRow - viewportTop, 0, height - 1);
        output += `\x1b[${finalScreenRow + 1};1H`;
        output += "\x1b[?2026l";
        this.terminal.write(output);

        state.previousLines = lines;
        state.previousKittyImageIds = state.collectKittyImageIds(lines);
        state.previousWidth = width;
        state.previousHeight = height;
        state.cursorRow = finalRow;
        state.hardwareCursorRow = viewportTop + finalScreenRow;
        state.maxLinesRendered = lines.length;
        state.previousViewportTop = viewportTop;
        this.#paintedLiveTailLineCount = liveTailLineCount;
        return true;
    }

    #liveTailLineCount(width: number, height: number): number {
        return this.children.reduce(
            (total, child) =>
                total +
                (isResizeLiveTailComponent(child) ? child.resizeLiveTailLineCount(width) : height),
            0,
        );
    }
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
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
