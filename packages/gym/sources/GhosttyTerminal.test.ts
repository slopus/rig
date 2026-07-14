import { afterEach, describe, expect, it } from "vitest";

import { GhosttyTerminal } from "./GhosttyTerminal.js";

const running = new Set<GhosttyTerminal>();

afterEach(() => {
    for (const terminal of running) terminal.close();
    running.clear();
});

describe("GhosttyTerminal cell styles", () => {
    it("reports default, palette, and RGB foreground colors", async () => {
        const terminal = await GhosttyTerminal.create(20, 4);
        running.add(terminal);
        terminal.write("a\x1b[36mb\x1b[38;2;1;2;3mc");

        const snapshot = await terminal.snapshot();
        expect(snapshot.cells.slice(0, 3)).toEqual([
            expect.objectContaining({ text: "a", foreground: null }),
            expect.objectContaining({
                text: "b",
                foreground: { kind: "palette", index: 6 },
            }),
            expect.objectContaining({
                text: "c",
                foreground: { kind: "rgb", red: 1, green: 2, blue: 3 },
            }),
        ]);
    });

    it("reports styled blank cells across a background surface", async () => {
        const terminal = await GhosttyTerminal.create(20, 4);
        running.add(terminal);
        terminal.write("\x1b[48;5;235m   \x1b[0m");

        const snapshot = await terminal.snapshot();
        expect(snapshot.cells.slice(0, 3)).toEqual([
            expect.objectContaining({ text: " ", background: { kind: "palette", index: 235 } }),
            expect.objectContaining({ text: " ", background: { kind: "palette", index: 235 } }),
            expect.objectContaining({ text: " ", background: { kind: "palette", index: 235 } }),
        ]);
    });

    it("returns terminal color-query responses to the PTY", async () => {
        const terminal = await GhosttyTerminal.create(20, 4);
        running.add(terminal);
        const responses: string[] = [];
        terminal.onPtyWrite((data) => responses.push(data));

        terminal.write("\x1b]10;?\x07\x1b]11;?\x07");
        await terminal.snapshot();

        expect(responses.join("")).toContain("rgb:");
        expect(responses.join("")).toContain("\x1b]10;");
        expect(responses.join("")).toContain("\x1b]11;");
    });
});

describe("GhosttyTerminal scroll tracking", () => {
    it("reports viewport offsets and retains cumulative top-jump counters", async () => {
        const terminal = await GhosttyTerminal.create(20, 4);
        running.add(terminal);
        terminal.write(
            Array.from({ length: 12 }, (_, index) => `line ${String(index).padStart(2, "0")}`)
                .join("\r\n")
                .concat("\r\n"),
        );

        const bottom = await terminal.snapshot();
        expect(bottom.scroll).toMatchObject({
            atBottom: true,
            atTop: false,
            bottomDepartureCount: 0,
            topArrivalCount: 0,
            visibleRows: 4,
        });
        expect(bottom.scroll.totalRows).toBeGreaterThan(bottom.scroll.visibleRows);
        expect(bottom.scroll.offset + bottom.scroll.visibleRows).toBe(bottom.scroll.totalRows);

        terminal.scrollToTop();
        const top = await terminal.snapshot();
        expect(top.scroll).toMatchObject({
            atBottom: false,
            atTop: true,
            bottomDepartureCount: 1,
            offset: 0,
            topArrivalCount: 1,
        });

        terminal.scrollBy(1);
        const middle = await terminal.snapshot();
        expect(middle.scroll.offset).toBe(1);
        expect(middle.scroll.atTop).toBe(false);

        terminal.scrollToBottom();
        const restored = await terminal.snapshot();
        expect(restored.scroll.atBottom).toBe(true);
        expect(restored.scroll.topArrivalCount).toBe(1);
        expect(restored.scroll.bottomDepartureCount).toBe(1);
    });
});
