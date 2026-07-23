import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { claudeReadTool } from "../../agent/tools/claude/Read.js";

describe("Claude Code Read tool", () => {
    it("returns numbered text", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/read.txt": "one\ntwo" },
        });

        const result = await harness.runTool(claudeReadTool, {
            file_path: "/workspace/read.txt",
        });

        expect("content" in result ? result.content : "").toBe("1\tone\n2\ttwo");
    });

    it("reads at most 2,000 lines by default while honoring an explicit limit", async () => {
        const content = Array.from({ length: 2_001 }, (_, index) => `line-${index + 1}`).join("\n");
        const harness = createJustBashToolHarness({
            files: { "/workspace/long.txt": content },
        });

        const defaultResult = await harness.runTool(claudeReadTool, {
            file_path: "/workspace/long.txt",
        });
        expect(defaultResult).toMatchObject({
            returnedLines: 2_000,
            totalLines: 2_001,
            truncated: true,
        });
        expect("content" in defaultResult ? defaultResult.content : "").toContain(
            "2000\tline-2000",
        );
        expect("content" in defaultResult ? defaultResult.content : "").not.toContain(
            "2001\tline-2001",
        );

        const explicitResult = await harness.runTool(claudeReadTool, {
            file_path: "/workspace/long.txt",
            limit: 2_001,
        });
        expect(explicitResult).toMatchObject({ returnedLines: 2_001, truncated: false });
    });

    it("rejects notebooks instead of presenting raw JSON as parsed cells", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/example.ipynb": '{"cells":[]}' },
        });

        const result = await harness.runTool(claudeReadTool, {
            file_path: "/workspace/example.ipynb",
        });

        expect("text" in result ? result.text : "").toContain("not supported");
    });

    it("rejects PDFs instead of decoding binary bytes as text", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/example.pdf": "%PDF-1.7\0binary" },
        });

        const result = await harness.runTool(claudeReadTool, {
            file_path: "/workspace/example.pdf",
        });

        expect("text" in result ? result.text : "").toContain("PDF rendering is not supported");
    });
});
