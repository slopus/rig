import { afterEach, describe, expect, it, vi } from "vitest";

import { ScrollbackPreservingTerminal } from "./ScrollbackPreservingTerminal.js";

describe("ScrollbackPreservingTerminal", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("removes scrollback purges while preserving routine redraw controls", () => {
        const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        const terminal = new ScrollbackPreservingTerminal();

        terminal.write("\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jframe\x1b[?2026l");

        expect(write).toHaveBeenCalledWith("\x1b[?2026h\x1b[2J\x1b[Hframe\x1b[?2026l");
    });
});
