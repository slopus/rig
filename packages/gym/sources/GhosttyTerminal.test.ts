import { afterEach, describe, expect, it } from "vitest";

import { GhosttyTerminal } from "./GhosttyTerminal.js";

const running = new Set<GhosttyTerminal>();

afterEach(() => {
    for (const terminal of running) terminal.close();
    running.clear();
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
