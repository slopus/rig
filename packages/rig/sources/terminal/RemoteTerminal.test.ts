import { describe, expect, it, vi } from "vitest";

import type { RemoteTerminalProcess } from "./RemoteTerminalProcess.js";
import { RemoteTerminal } from "./RemoteTerminal.js";
import type { RemoteTerminalRow } from "./types.js";

describe("RemoteTerminal", () => {
    it("tracks a bounded visible frame and pages through Ghostty scrollback", async () => {
        const process = new FakeTerminalProcess();
        const terminal = await RemoteTerminal.create({
            cols: 8,
            maxScrollback: 100,
            processFactory: { start: async () => process },
            processOptions: { cols: 8, cwd: "/tmp", rows: 2 },
            rows: 2,
        });

        expect(terminal.frame()).toMatchObject({ revision: 0, status: "running", totalRows: 2 });
        process.emit("one\r\ntwo\r\nthree\r\nfour");
        await vi.waitFor(() => expect(terminal.frame().revision).toBe(1));

        expect(terminal.frame().rows.map(rowText)).toEqual(["three", "four"]);
        const scrollback = await terminal.scrollback(0, 20);
        expect(scrollback.rows.map(rowText)).toEqual(["one", "two", "three", "four"]);
        expect(scrollback).toMatchObject({ revision: 1, startRow: 0, totalRows: 4 });

        const resized = await terminal.resize(12, 3);
        expect(resized).toMatchObject({ cols: 12, revision: 2 });
        expect(process.resizes).toEqual([{ cols: 12, rows: 3 }]);
        expect(terminal.framesSince(0)?.map((frame) => frame.revision)).toEqual([2]);

        process.finish(7);
        await vi.waitFor(() => expect(terminal.frame().status).toBe("exited"));
        expect(terminal.frame()).toMatchObject({ exitCode: 7, revision: 3, status: "exited" });
        expect(terminal.framesSince(2)?.map((frame) => frame.revision)).toEqual([3]);
        await terminal.dispose();
    }, 60_000);

    it("coalesces output while preserving styled cells and monotonic frames", async () => {
        const process = new FakeTerminalProcess();
        const terminal = await RemoteTerminal.create({
            cols: 10,
            maxScrollback: 10,
            processFactory: { start: async () => process },
            processOptions: { cols: 10, cwd: "/tmp", rows: 2 },
            rows: 2,
        });
        const revisions: number[] = [];
        terminal.subscribe((frame) => revisions.push(frame.revision));

        process.emit("\x1b[1;31mred");
        process.emit(" text\x1b[0m");
        await vi.waitFor(() => expect(terminal.frame().revision).toBeGreaterThan(0));

        const red = terminal
            .frame()
            .rows.flatMap((row) => row.cells)
            .find((cell) => cell.text === "r");
        expect(red?.style).toMatchObject({
            bold: true,
            foreground: { index: 1, kind: "palette" },
        });
        expect(revisions).toEqual([...revisions].sort((left, right) => left - right));
        await terminal.dispose();
    }, 60_000);
});

class FakeTerminalProcess implements RemoteTerminalProcess {
    readonly resizes: { cols: number; rows: number }[] = [];
    readonly writes: Uint8Array[] = [];
    #data = new Set<(data: Uint8Array) => void>();
    #exit: Promise<{ exitCode: number | null }>;
    #resolveExit!: (exit: { exitCode: number | null }) => void;
    #finished = false;

    constructor() {
        this.#exit = new Promise((resolve) => {
            this.#resolveExit = resolve;
        });
    }

    emit(data: string): void {
        for (const listener of this.#data) listener(Buffer.from(data));
    }

    finish(exitCode: number | null): void {
        if (this.#finished) return;
        this.#finished = true;
        this.#resolveExit({ exitCode });
    }

    kill(): void {
        this.finish(null);
    }

    onData(listener: (data: Uint8Array) => void): () => void {
        this.#data.add(listener);
        return () => this.#data.delete(listener);
    }

    resize(cols: number, rows: number): void {
        this.resizes.push({ cols, rows });
    }

    wait(): Promise<{ exitCode: number | null }> {
        return this.#exit;
    }

    write(data: string | Uint8Array): boolean {
        this.writes.push(Buffer.from(data));
        return true;
    }
}

function rowText(row: RemoteTerminalRow): string {
    const cells = Array.from({ length: 256 }, () => " ");
    let width = 0;
    for (const cell of row.cells) {
        cells[cell.x] = cell.text;
        width = Math.max(width, cell.x + cell.width);
    }
    return cells.slice(0, width).join("").trimEnd();
}
