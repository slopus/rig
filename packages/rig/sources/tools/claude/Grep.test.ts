import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { claudeGrepTool } from "./Grep.js";

describe("Claude Code Grep tool", () => {
    it("returns files with matches by default", async () => {
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/a.txt": "needle\n",
                "/workspace/b.txt": "hay\n",
            },
        });

        const result = await harness.runTool(claudeGrepTool, {
            pattern: "needle",
        });

        expect(result.text).toBe("/workspace/a.txt");
        expect(claudeGrepTool.toUI(result, { pattern: "needle" })).toBe(
            'Searched "needle" (1 output line)',
        );
    });

    it("treats a dash-prefixed pattern as search text", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/arrows.txt": "left -> right\n" },
        });

        const result = await harness.runTool(claudeGrepTool, {
            output_mode: "content",
            path: "/workspace",
            pattern: "->",
        });

        expect(result.text).toContain("left -> right");
    });

    it("truncates long lines and bounds combined output at 50KB", async () => {
        const content = Array.from(
            { length: 101 },
            (_, index) => `needle-${String(index).padStart(3, "0")}-${"x".repeat(600)}`,
        ).join("\n");
        const harness = createJustBashToolHarness({
            files: { "/workspace/long.txt": content },
        });

        const result = await harness.runTool(claudeGrepTool, {
            output_mode: "content",
            path: "/workspace",
            pattern: "needle",
        });

        expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(50 * 1024);
        expect(result.text).toContain("50KB limit reached");
        expect(result.text).toContain("Some lines truncated to 500 chars");
        expect(result.text).not.toContain("x".repeat(501));
    });
});
