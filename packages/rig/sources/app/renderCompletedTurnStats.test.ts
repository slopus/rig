import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { renderCompletedTurnStats } from "./renderCompletedTurnStats.js";
import { stripAnsi } from "./testing/stripAnsi.js";

describe("renderCompletedTurnStats", () => {
    it("renders readable stats without exceeding a narrow terminal", () => {
        const rendered = renderCompletedTurnStats(
            {
                additions: 214,
                deletions: 37,
                elapsedMs: 138_000,
                fileCount: 8,
                toolCount: 12,
            },
            30,
        );

        expect(visibleWidth(rendered)).toBeLessThanOrEqual(30);
        expect(stripAnsi(rendered)).toBe("• Worked for 2m 18s · 12 tools");
    });
});
