import { describe, expect, it } from "vitest";
import type { Terminal } from "@earendil-works/pi-tui";

import { ScrollbackPreservingTUI } from "./ScrollbackPreservingTUI.js";

describe("ScrollbackPreservingTUI", () => {
    it("resets terminal styling before a forced full redraw clears the screen", async () => {
        const terminal = new RecordingTerminal(20, 5);
        const tui = new ScrollbackPreservingTUI(terminal, false);
        tui.addChild({ invalidate: () => {}, render: () => ["frame"] });
        tui.start();
        await renderCycle();
        terminal.output.length = 0;

        tui.requestRender(true);
        await renderCycle();

        expect(terminal.output[0]).toBe("\x1b[0m");
        expect(terminal.output.join("")).toContain("\x1b[?2026h\x1b[2J");
        tui.stop();
    });

    it("adopts native history reflow and redraws only the live tail at the new width", async () => {
        const terminal = new RecordingTerminal(20, 5);
        const tui = new ScrollbackPreservingTUI(terminal, false);
        const component = {
            invalidate: () => {},
            render: (width: number) => [
                "history 1",
                "history 2",
                "history 3",
                "history 4",
                "history 5",
                "history 6",
                "history 7",
                "history 8",
                `input at ${width}`,
            ],
            resizeLiveTailLineCount: () => 1,
        };
        tui.addChild(component);
        tui.start();
        await renderCycle();

        terminal.columns = 30;
        tui.requestRender();
        await renderCycle();

        const output = terminal.output.join("");
        expect(output.match(/history 1/gu)).toHaveLength(1);
        expect(output).toContain("input at 30");
        expect(output).not.toContain("\x1b[3J");
        expect(output).not.toContain("\x1b[2J");
        tui.stop();
    });

    it("clears the live tail height that was actually painted before a width resize", async () => {
        const terminal = new RecordingTerminal(20, 5);
        const tui = new ScrollbackPreservingTUI(terminal, false);
        let liveTailLineCount = 3;
        const component = {
            invalidate: () => {},
            render: () => [
                "history 1",
                "history 2",
                "history 3",
                "history 4",
                "history 5",
                "history 6",
                ...(liveTailLineCount === 3
                    ? ["old input", "old status", "old footer"]
                    : ["new input"]),
            ],
            resizeLiveTailLineCount: () => liveTailLineCount,
        };
        tui.addChild(component);
        tui.start();
        await renderCycle();
        terminal.output.length = 0;

        liveTailLineCount = 1;
        terminal.columns = 30;
        tui.requestRender();
        await renderCycle();

        const output = terminal.output.join("");
        expect(output).not.toContain("\x1b[2;1H\x1b[2K");
        expect(output).toContain("\x1b[3;1H\x1b[2K");
        expect(output).toContain("\x1b[4;1H\x1b[2K");
        expect(output).toContain("\x1b[5;1H\x1b[2Knew input");
        tui.stop();
    });

    it("keeps a widened short frame bottom-aligned for the next incremental render", async () => {
        const terminal = new RecordingTerminal(10, 6);
        const tui = new ScrollbackPreservingTUI(terminal, false);
        let footer = "footer";
        const component = {
            invalidate: () => {},
            render: (width: number) =>
                width === 10
                    ? [
                          "history 1",
                          "history 2",
                          "history 3",
                          "history 4",
                          "history 5",
                          "history 6",
                          "history 7",
                          "input",
                          "status",
                          footer,
                      ]
                    : ["reflowed history", "input", "status", footer],
            resizeLiveTailLineCount: () => 3,
        };
        tui.addChild(component);
        tui.start();
        await renderCycle();
        terminal.output.length = 0;

        terminal.columns = 30;
        tui.requestRender();
        await renderCycle();

        const resizeOutput = terminal.output.join("");
        const state = tui as unknown as {
            cursorRow: number;
            hardwareCursorRow: number;
            maxLinesRendered: number;
            previousLines: string[];
            previousViewportTop: number;
        };
        expect(resizeOutput).toContain("\x1b[4;1H\x1b[2Kinput");
        expect(resizeOutput).toContain("\x1b[6;1H\x1b[2Kfooter");
        expect(state.previousLines).toHaveLength(6);
        expect(state.previousLines[2]).toContain("reflowed history");
        expect(state.previousLines[5]).toContain("footer");
        expect(state.previousViewportTop).toBe(0);
        expect(state.cursorRow).toBe(5);
        expect(state.hardwareCursorRow).toBe(5);
        expect(state.maxLinesRendered).toBe(6);
        terminal.output.length = 0;

        footer = "updated footer";
        tui.requestRender();
        await renderCycle();

        const incrementalOutput = terminal.output.join("");
        expect(incrementalOutput.match(/updated footer/gu)).toHaveLength(1);
        expect(incrementalOutput).not.toContain("input");
        expect(incrementalOutput).not.toContain("reflowed history");
        expect(incrementalOutput).not.toContain("\x1b[2J");
        expect(incrementalOutput).not.toContain("\x1b[3J");
        tui.stop();
    });

    it("source-renders the complete top viewport when all stable content still fits", async () => {
        const terminal = new RecordingTerminal(30, 6);
        const tui = new ScrollbackPreservingTUI(terminal, false);
        const component = {
            invalidate: () => {},
            render: (width: number) => [`header at ${width}`, "status", `input at ${width}`],
            resizeLiveTailLineCount: () => 1,
        };
        tui.addChild(component);
        tui.start();
        await renderCycle();
        terminal.output.length = 0;

        terminal.columns = 19;
        tui.requestRender();
        await renderCycle();

        const output = terminal.output.join("");
        expect(output).toContain("header at 19");
        expect(output).toContain("status");
        expect(output).toContain("input at 19");
        expect(output).not.toContain("\x1b[3J");
        expect(output).not.toContain("\x1b[2J");
        tui.stop();
    });

    it("keeps the viewport in place after growth when the terminal keeps rows fixed", async () => {
        const terminal = new ProbeAnsweringTerminal(30, 5);
        const tui = new ScrollbackPreservingTUI(terminal, false);
        tui.addChild(overflowingComponent());
        tui.start();
        await renderCycle();
        terminal.output.length = 0;

        terminal.rows = 8;
        terminal.cursorReportRow = 4;
        tui.requestRender();
        await renderCycle();

        const output = terminal.output.join("");
        expect(output).toContain("\x1b[6n");
        expect(output).not.toContain("history 9");
        expect(output).toContain("\x1b[3;1H\x1b[2Kinput");
        expect(output).toContain("\x1b[5;1H\x1b[2Kfooter");
        expect(output).toContain("\x1b[8;1H\x1b[2K");
        expect(output).toContain("\x1b[5;1H\x1b[?2026l");
        expect(output).not.toContain("\x1b[3J");
        expect(output).not.toContain("\x1b[2J");
        tui.stop();
    });

    it("bottom-anchors after growth when the terminal pulls history back on screen", async () => {
        const terminal = new ProbeAnsweringTerminal(30, 5);
        const tui = new ScrollbackPreservingTUI(terminal, false);
        tui.addChild(overflowingComponent());
        tui.start();
        await renderCycle();
        terminal.output.length = 0;

        terminal.rows = 8;
        terminal.cursorReportRow = 7;
        tui.requestRender();
        await renderCycle();

        const output = terminal.output.join("");
        expect(output).not.toContain("history");
        expect(output).toContain("\x1b[6;1H\x1b[2Kinput");
        expect(output).toContain("\x1b[8;1H\x1b[2Kfooter");
        expect(output).not.toContain("\x1b[3;1H\x1b[2Kinput");
        expect(output).toContain("\x1b[8;1H\x1b[?2026l");
        expect(output).not.toContain("\x1b[3J");
        expect(output).not.toContain("\x1b[2J");
        tui.stop();
    });

    it("falls back to a fixed-row repaint when the cursor probe goes unanswered", async () => {
        const terminal = new ProbeAnsweringTerminal(30, 5);
        const tui = new ScrollbackPreservingTUI(terminal, false);
        tui.addChild(overflowingComponent());
        tui.start();
        await renderCycle();
        terminal.output.length = 0;

        terminal.rows = 8;
        tui.requestRender();
        await new Promise((resolve) => setTimeout(resolve, 300));

        const output = terminal.output.join("");
        expect(output).toContain("\x1b[3;1H\x1b[2Kinput");
        expect(output).toContain("\x1b[5;1H\x1b[2Kfooter");
        expect(output).toContain("\x1b[5;1H\x1b[?2026l");
        tui.stop();
    });

    it("retains a short session without replaying scrolled history after vertical growth", async () => {
        const terminal = new ProbeAnsweringTerminal(30, 5);
        const tui = new ScrollbackPreservingTUI(terminal, false);
        const component = {
            invalidate: () => {},
            render: () => ["header", "status", "user", "reply", "", "input", "footer"],
            resizeLiveTailLineCount: () => 3,
        };
        tui.addChild(component);
        tui.start();
        await renderCycle();
        terminal.output.length = 0;

        terminal.rows = 10;
        terminal.cursorReportRow = 4;
        tui.requestRender();
        await renderCycle();

        const output = terminal.output.join("");
        expect(output).not.toContain("header");
        expect(output).toContain("\x1b[4;1H\x1b[2Kinput");
        expect(output).toContain("\x1b[5;1H\x1b[2Kfooter");
        expect(output).toContain("\x1b[10;1H\x1b[2K");
        expect(output).toContain("\x1b[5;1H\x1b[?2026l");
        expect(output).not.toContain("\x1b[3J");
        expect(output).not.toContain("\x1b[2J");
        tui.stop();
    });

    it("aligns a short session with history the terminal pulled back after growth", async () => {
        const terminal = new ProbeAnsweringTerminal(30, 5);
        const tui = new ScrollbackPreservingTUI(terminal, false);
        const component = {
            invalidate: () => {},
            render: () => ["header", "status", "user", "reply", "", "input", "footer"],
            resizeLiveTailLineCount: () => 3,
        };
        tui.addChild(component);
        tui.start();
        await renderCycle();
        terminal.output.length = 0;

        terminal.rows = 10;
        terminal.cursorReportRow = 6;
        tui.requestRender();
        await renderCycle();

        const output = terminal.output.join("");
        expect(output).not.toContain("header");
        expect(output).toContain("\x1b[6;1H\x1b[2Kinput");
        expect(output).toContain("\x1b[7;1H\x1b[2Kfooter");
        expect(output).toContain("\x1b[7;1H\x1b[?2026l");
        tui.stop();
    });

    it("keeps the live tail at the bottom when shrinking pushes rows into scrollback", async () => {
        const terminal = new ProbeAnsweringTerminal(30, 8);
        const tui = new ScrollbackPreservingTUI(terminal, false);
        tui.addChild(overflowingComponent());
        tui.start();
        await renderCycle();
        terminal.output.length = 0;

        terminal.rows = 5;
        terminal.cursorReportRow = 4;
        tui.requestRender();
        await renderCycle();

        const output = terminal.output.join("");
        expect(output).toContain("\x1b[3;1H\x1b[2Kinput");
        expect(output).toContain("\x1b[5;1H\x1b[2Kfooter");
        expect(output).toContain("\x1b[5;1H\x1b[?2026l");
        tui.stop();
    });
});

function overflowingComponent() {
    return {
        invalidate: () => {},
        render: () => [
            "history 1",
            "history 2",
            "history 3",
            "history 4",
            "history 5",
            "history 6",
            "history 7",
            "history 8",
            "history 9",
            "input",
            "status",
            "footer",
        ],
        resizeLiveTailLineCount: () => 3,
    };
}

class RecordingTerminal implements Terminal {
    readonly output: string[] = [];
    readonly kittyProtocolActive = false;
    columns: number;
    rows: number;

    constructor(columns: number, rows: number) {
        this.columns = columns;
        this.rows = rows;
    }

    protected onInput: ((data: string) => void) | undefined;

    start(onInput?: (data: string) => void): void {
        this.onInput = onInput;
    }
    stop(): void {}
    async drainInput(): Promise<void> {}
    write(data: string): void {
        this.output.push(data);
    }
    moveBy(): void {}
    hideCursor(): void {}
    showCursor(): void {}
    clearLine(): void {}
    clearFromCursor(): void {}
    clearScreen(): void {}
    setTitle(): void {}
    setProgress(): void {}
}

class ProbeAnsweringTerminal extends RecordingTerminal {
    cursorReportRow: number | undefined;

    override write(data: string): void {
        super.write(data);
        if (data.includes("\x1b[6n") && this.cursorReportRow !== undefined) {
            const reply = `\x1b[${this.cursorReportRow + 1};1R`;
            queueMicrotask(() => this.onInput?.(reply));
        }
    }
}

async function renderCycle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 25));
}
