import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { claudeGlobTool } from "./Glob.js";

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
});
