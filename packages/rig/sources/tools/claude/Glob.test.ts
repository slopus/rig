import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { claudeGlobTool } from "../../agent/tools/claude/Glob.js";

describe("Claude Code Glob tool", () => {
    it("returns matching files", async () => {
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/src/app.ts": "app",
                "/workspace/src/app.js": "app",
            },
        });

        const result = await harness.runTool(claudeGlobTool, {
            pattern: "**/*.ts",
        });

        expect(result.text).toBe("/workspace/src/app.ts");
    });

    it("matches direct and nested children with a directory globstar", async () => {
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/src/direct.ts": "direct",
                "/workspace/src/nested/child.ts": "nested",
            },
        });

        const result = await harness.runTool(claudeGlobTool, {
            pattern: "src/**/*.ts",
        });

        expect(result.text.split("\n").sort()).toEqual([
            "/workspace/src/direct.ts",
            "/workspace/src/nested/child.ts",
        ]);
    });

    it("keeps results when one child directory cannot be read", async () => {
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/available.ts": "available",
                "/workspace/unreadable/hidden.ts": "hidden",
            },
        });
        const readdir = harness.context.fs.readdir.bind(harness.context.fs);
        harness.context.fs.readdir = async (path) => {
            if (path === "/workspace/unreadable")
                throw new Error("EACCES: directory is unreadable");
            return readdir(path);
        };

        const result = await harness.runTool(claudeGlobTool, { pattern: "**/*.ts" });

        expect(result.text).toBe("/workspace/available.ts");
    });

    it("reports when matching files exceed the result limit", async () => {
        const harness = createJustBashToolHarness({
            files: Object.fromEntries(
                Array.from({ length: 101 }, (_, index) => [
                    `/workspace/file-${String(index).padStart(3, "0")}.ts`,
                    "content",
                ]),
            ),
        });

        const result = await harness.runTool(claudeGlobTool, { pattern: "**/*.ts" });

        expect(result.text).toContain(
            "(Results are truncated. Consider using a more specific path or pattern.)",
        );
        expect(result).toMatchObject({ numFiles: 100, truncated: true });
        expect(claudeGlobTool.toUI(result, { pattern: "**/*.ts" })).toBe(
            'Found files for "**/*.ts" (100, truncated)',
        );
    });

    it("does not report truncation when matches exactly fill the result limit", async () => {
        const harness = createJustBashToolHarness({
            files: Object.fromEntries(
                Array.from({ length: 100 }, (_, index) => [
                    `/workspace/file-${String(index).padStart(3, "0")}.ts`,
                    "content",
                ]),
            ),
        });

        const result = await harness.runTool(claudeGlobTool, { pattern: "**/*.ts" });

        expect(result.text).not.toContain("Results are truncated");
        expect(result).toMatchObject({ numFiles: 100, truncated: false });
    });
});
