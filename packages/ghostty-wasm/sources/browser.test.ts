import { readFile } from "node:fs/promises";

import { afterEach, expect, it, vi } from "vitest";

import { createGhosttyTerminal, createGhosttyTerminalFromWasm } from "./browser.js";

afterEach(() => vi.unstubAllGlobals());

it("loads the same bundled WASM through fetch in browsers", async () => {
    const bytes = await readFile(new URL("../wasm/ghostty-vt.wasm", import.meta.url));
    const fetch = vi.fn(async (_input: string | URL) => new Response(bytes));
    vi.stubGlobal("fetch", fetch);

    const terminal = await createGhosttyTerminal({ cols: 8, rows: 2 });
    try {
        terminal.write("browser");
        expect(
            terminal
                .snapshot()
                .rows[0]?.cells.map((cell) => cell.text)
                .join(""),
        ).toBe("browser");
        expect(fetch).toHaveBeenCalledOnce();
        expect(String(fetch.mock.calls[0]?.[0])).toContain("/wasm/ghostty-vt.wasm");
    } finally {
        terminal.dispose();
    }
});

it("bypasses the bundled fetch loader when a custom loader is supplied", async () => {
    const file = await readFile(new URL("../wasm/ghostty-vt.wasm", import.meta.url));
    const wasm = Uint8Array.from(file).buffer;
    const fetch = vi.fn(async (_input: string | URL) => {
        throw new Error("The bundled loader should not run.");
    });
    const loadWasm = vi.fn(() => wasm);
    vi.stubGlobal("fetch", fetch);

    const terminal = await createGhosttyTerminal({ cols: 8, loadWasm, rows: 2 });
    try {
        terminal.write("custom");
        expect(
            terminal
                .snapshot()
                .rows[0]?.cells.map((cell) => cell.text)
                .join(""),
        ).toBe("custom");
        expect(loadWasm).toHaveBeenCalledOnce();
        expect(fetch).not.toHaveBeenCalled();
    } finally {
        terminal.dispose();
    }
});

it("creates a terminal directly from caller-provided WASM bytes", async () => {
    const file = await readFile(new URL("../wasm/ghostty-vt.wasm", import.meta.url));
    const terminal = await createGhosttyTerminalFromWasm(Uint8Array.from(file).buffer, {
        cols: 8,
        rows: 2,
    });

    try {
        terminal.write("direct");
        expect(
            terminal
                .snapshot()
                .rows[0]?.cells.map((cell) => cell.text)
                .join(""),
        ).toBe("direct");
    } finally {
        terminal.dispose();
    }
});
