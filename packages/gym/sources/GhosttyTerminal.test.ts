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

    it("returns terminal color-query responses when OSC sequences span PTY chunks", async () => {
        const terminal = await GhosttyTerminal.create(20, 4);
        running.add(terminal);
        const responses: string[] = [];
        terminal.onPtyWrite((data) => responses.push(data));

        terminal.write("\x1b]1");
        await terminal.snapshot();
        expect(responses).toEqual([]);

        terminal.write("0;?");
        terminal.write("\x07\x1b]11;");
        await terminal.snapshot();
        expect(responses.join("")).toContain("\x1b]10;rgb:eeee/eeee/eeee\x1b\\");
        expect(responses.join("")).not.toContain("\x1b]11;");

        terminal.write("?\x07");
        await terminal.snapshot();
        expect(responses.join("")).toContain("\x1b]11;rgb:0d0d/0d0d/0d0d\x1b\\");
    });

    it("observes application output separately from terminal replies", async () => {
        const terminal = await GhosttyTerminal.create(20, 4);
        running.add(terminal);
        const output: string[] = [];
        const replies: string[] = [];
        terminal.onOutput((data) => output.push(data));
        terminal.onPtyWrite((data) => replies.push(data));

        terminal.write("visible\x1b]11;?\x07");
        await terminal.snapshot();

        expect(output).toEqual(["visible\x1b]11;?\x07"]);
        expect(replies.join("")).toContain("\x1b]11;");
        expect(output.join("")).not.toContain("rgb:");
    });

    it("returns primary device attributes to the PTY", async () => {
        const terminal = await GhosttyTerminal.create(20, 4);
        running.add(terminal);
        const responses: string[] = [];
        terminal.onPtyWrite((data) => responses.push(data));

        terminal.write("\x1b[c");
        await terminal.snapshot();

        expect(responses).toEqual(["\x1b[?62;22c"]);
    });

    it("preserves UTF-8 code points split across output chunks", async () => {
        const terminal = await GhosttyTerminal.create(20, 4);
        running.add(terminal);
        const bytes = Buffer.from("e\u0301界🙂");
        const output: string[] = [];
        terminal.onOutput((data) => output.push(data));

        for (const byte of bytes) terminal.writeBytes(Uint8Array.of(byte));

        expect((await terminal.snapshot()).text).toBe("e\u0301界🙂");
        expect(output.join("")).toBe("e\u0301界🙂");
    });

    it("publishes output only after the terminal state is current", async () => {
        const terminal = await GhosttyTerminal.create(20, 4);
        running.add(terminal);
        let observed: Promise<string> | undefined;
        terminal.onOutput(() => {
            observed = terminal.snapshot().then((snapshot) => snapshot.text);
        });

        terminal.write("visible");

        await expect(observed).resolves.toBe("visible");
    });

    it("normalizes cleared cells back to the effective default background", async () => {
        const terminal = await GhosttyTerminal.create(20, 4);
        running.add(terminal);

        terminal.write("\x1b[48;5;235m\x1b[2J");
        const snapshot = await terminal.snapshot();

        expect(snapshot.cells).toEqual([]);
        expect(snapshot.defaultBackground).toEqual({
            kind: "rgb",
            red: 13,
            green: 13,
            blue: 13,
        });
    });

    it("tracks synchronized output markers split across PTY chunks", async () => {
        const terminal = await GhosttyTerminal.create(20, 4);
        running.add(terminal);

        terminal.write("\x1b[?20");
        terminal.write("26hframe");
        expect((await terminal.snapshot()).synchronizedOutputActive).toBe(true);

        terminal.write("\x1b[?2026");
        terminal.write("l");
        expect((await terminal.snapshot()).synchronizedOutputActive).toBe(false);
    });

    it("tracks color-scheme notification mode split across PTY chunks", async () => {
        const terminal = await GhosttyTerminal.create(20, 4);
        running.add(terminal);
        const replies: string[] = [];
        terminal.onPtyWrite((data) => replies.push(data));

        terminal.write("\x1b[?20");
        await terminal.snapshot();
        terminal.write("31h");
        await terminal.snapshot();
        terminal.setColorScheme("light");
        terminal.write("");
        await terminal.snapshot();

        expect(replies).toContain("\x1b[?997;2n");

        replies.length = 0;
        terminal.write("\x1b[?20");
        await terminal.snapshot();
        terminal.write("31l");
        await terminal.snapshot();
        terminal.setColorScheme("dark");
        terminal.write("");
        await terminal.snapshot();

        expect(replies).not.toContain("\x1b[?997;1n");
    });

    it("reports updated effective terminal defaults", async () => {
        const terminal = await GhosttyTerminal.create(20, 4, "light");
        running.add(terminal);

        const snapshot = await terminal.snapshot();
        expect(snapshot.defaultForeground).toEqual({
            kind: "rgb",
            red: 13,
            green: 13,
            blue: 13,
        });
        expect(snapshot.defaultBackground).toEqual({
            kind: "rgb",
            red: 238,
            green: 238,
            blue: 238,
        });
    });
});

describe("GhosttyTerminal snapshot revisions", () => {
    it("reports only output queued before the snapshot request", async () => {
        const terminal = await GhosttyTerminal.create(20, 4);
        running.add(terminal);
        terminal.write("before");

        const snapshotPromise = terminal.snapshot();
        terminal.write("after");

        const snapshot = await snapshotPromise;
        expect(snapshot.text).toContain("before");
        expect(snapshot.text).not.toContain("after");
        expect(snapshot.outputRevision).toBe(1);

        const current = await terminal.snapshot();
        expect(current.text).toContain("after");
        expect(current.outputRevision).toBe(2);
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
