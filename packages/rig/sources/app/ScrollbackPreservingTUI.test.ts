import { describe, expect, it } from "vitest";
import type { Component, Terminal } from "@earendil-works/pi-tui";

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

    it("replays source-rendered history once at the new width", async () => {
        const terminal = new RecordingTerminal(20, 5);
        const tui = new ScrollbackPreservingTUI(terminal, false);
        const component: Component = {
            invalidate: () => {},
            render: (width) => ["history 1", "history 2", `input at ${width}`],
        };
        tui.addChild(component);
        tui.start();
        await renderCycle();

        terminal.columns = 30;
        tui.requestRender();
        await renderCycle();

        const output = terminal.output.join("");
        expect(output.match(/history 1/gu)).toHaveLength(2);
        expect(output).toContain("input at 30");
        expect(output).toContain("\x1b[3J");
        tui.stop();
    });
});

class RecordingTerminal implements Terminal {
    readonly output: string[] = [];
    readonly kittyProtocolActive = false;
    columns: number;
    rows: number;

    constructor(columns: number, rows: number) {
        this.columns = columns;
        this.rows = rows;
    }

    start(): void {}
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

async function renderCycle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 25));
}
