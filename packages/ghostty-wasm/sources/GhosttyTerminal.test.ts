import { afterEach, describe, expect, it } from "vitest";

import { createGhosttyTerminal, type GhosttyTerminal } from "./node.js";

describe("GhosttyTerminal", () => {
    let terminal: GhosttyTerminal | undefined;

    afterEach(() => terminal?.dispose());

    it("loads the bundled WASM in Node and preserves terminal styling", async () => {
        terminal = await createGhosttyTerminal({ cols: 10, rows: 3 });
        terminal.write("plain\r\n\u001b[1;3;4;31;48;2;4;5;6mstyled\u001b[0m");

        const snapshot = terminal.snapshot();
        const styled = snapshot.rows[1]?.cells[0];

        expect(snapshot.rows[0]?.cells.map((cell) => cell.text).join("")).toBe("plain");
        expect(styled).toMatchObject({
            style: {
                background: { blue: 6, green: 5, kind: "rgb", red: 4 },
                bold: true,
                foreground: { index: 1, kind: "palette" },
                italic: true,
                underline: "single",
            },
            text: "s",
        });
    });

    it("never reuses stale render styles for default cells", async () => {
        terminal = await createGhosttyTerminal({ cols: 12, rows: 2 });
        terminal.write("\x1b[1;38;5;202;48;5;235mstyled\x1b[0m");
        terminal.snapshot();
        terminal.write("\r\x1b[2Kplain");

        expect(terminal.snapshot().rows[0]?.cells).toEqual([
            expect.objectContaining({
                style: {
                    background: null,
                    blink: false,
                    bold: false,
                    dim: false,
                    foreground: null,
                    invisible: false,
                    inverse: false,
                    italic: false,
                    overline: false,
                    strikethrough: false,
                    underline: "none",
                    underlineColor: null,
                },
                text: "p",
            }),
            expect.objectContaining({
                style: expect.objectContaining({ background: null, foreground: null }),
                text: "l",
            }),
            expect.objectContaining({
                style: expect.objectContaining({ background: null, foreground: null }),
                text: "a",
            }),
            expect.objectContaining({
                style: expect.objectContaining({ background: null, foreground: null }),
                text: "i",
            }),
            expect.objectContaining({
                style: expect.objectContaining({ background: null, foreground: null }),
                text: "n",
            }),
        ]);
    });

    it("keeps grapheme clusters, wide cells, wrapping, scrollback, and split titles", async () => {
        terminal = await createGhosttyTerminal({ cols: 4, rows: 2 });
        terminal.write("e\u0301界");

        const unicodeCells = terminal.snapshot().rows.flatMap((row) => row.cells);
        expect(unicodeCells).toContainEqual(expect.objectContaining({ text: "é", width: 1 }));
        expect(unicodeCells).toContainEqual(expect.objectContaining({ text: "界", width: 2 }));

        terminal.write("12345\u001b]2;split");
        expect(terminal.snapshot().rows.some((row) => row.wrapped)).toBe(true);
        terminal.write(" title\u001b\\\r\nnext\r\nlast");

        const snapshot = terminal.snapshot();
        expect(snapshot.title).toBe("split title");
        expect(snapshot.totalRows).toBeGreaterThan(snapshot.rows.length);
        expect(snapshot.startRow).toBe(snapshot.totalRows - snapshot.rows.length);
    });

    it("scrolls the native Ghostty viewport and restores it after reading any history page", async () => {
        terminal = await createGhosttyTerminal({ cols: 12, rows: 3 });
        terminal.write(Array.from({ length: 10 }, (_, index) => `line-${index}`).join("\r\n"));

        const bottom = terminal.snapshot();
        expect(bottom.startRow).toBe(bottom.totalRows - bottom.visibleRows);

        terminal.scrollToTop();
        expect(terminal.snapshot()).toMatchObject({ startRow: 0 });
        terminal.scrollBy(2);
        expect(terminal.snapshot()).toMatchObject({ startRow: 2 });

        const history = terminal.snapshotPage(1, 7);
        expect(history.startRow).toBe(1);
        expect(history.rows.map(rowText)).toEqual([
            "line-1",
            "line-2",
            "line-3",
            "line-4",
            "line-5",
            "line-6",
            "line-7",
        ]);
        expect(terminal.snapshot()).toMatchObject({ startRow: 2 });

        terminal.scrollToBottom();
        expect(terminal.snapshot().startRow).toBe(bottom.startRow);
    });

    it("preserves split UTF-8 and grapheme clusters across individual writes", async () => {
        terminal = await createGhosttyTerminal({ cols: 20, rows: 2 });
        const bytes = new TextEncoder().encode("A🙂\u0301界 e\u0301");
        for (const byte of bytes) terminal.write(Uint8Array.of(byte));

        expect(terminal.snapshot().rows.map(rowText).join("\n")).toContain("A🙂́界 é");
    });

    it("emits terminal replies and reports color-scheme and synchronized-output modes", async () => {
        terminal = await createGhosttyTerminal({ cols: 10, rows: 2 });
        const replies: string[] = [];
        terminal.onPtyWrite((data) => replies.push(new TextDecoder().decode(data)));

        terminal.write("\x1b]10;");
        terminal.write("?\x1b]11;?\x1b[c");
        expect(replies).toEqual([
            "\x1b]10;rgb:eeee/eeee/eeee\x1b\\",
            "\x1b]11;rgb:0d0d/0d0d/0d0d\x1b\\",
            "\x1b[?62;22c",
        ]);

        terminal.write("\x1b[?2026h\x1b[?2031h");
        expect(terminal.snapshot().synchronizedOutputActive).toBe(true);
        terminal.setColorScheme("light");
        expect(terminal.snapshot()).toMatchObject({
            defaultBackground: { blue: 238, green: 238, kind: "rgb", red: 238 },
            defaultForeground: { blue: 13, green: 13, kind: "rgb", red: 13 },
        });
        expect(replies.at(-1)).toBe("\x1b[?997;2n");

        const replyCount = replies.length;
        terminal.write("\x1b[?2026l\x1b[?2031l");
        expect(terminal.snapshot().synchronizedOutputActive).toBe(false);
        terminal.setColorScheme("dark");
        expect(replies).toHaveLength(replyCount);
    });

    it("is safe to dispose more than once and rejects later use", async () => {
        terminal = await createGhosttyTerminal();
        terminal.dispose();
        terminal.dispose();

        expect(() => terminal?.write("late")).toThrow("disposed");
        terminal = undefined;
    });
});

function rowText(row: { cells: readonly { text: string; width: number; x: number }[] }): string {
    let result = "";
    let column = 0;
    for (const cell of row.cells) {
        result += " ".repeat(Math.max(0, cell.x - column));
        result += cell.text;
        column = cell.x + cell.width;
    }
    return result.trimEnd();
}
