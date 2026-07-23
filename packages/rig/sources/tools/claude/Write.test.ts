import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { claudeReadTool } from "../../agent/tools/claude/Read.js";
import { claudeWriteTool } from "../../agent/tools/claude/Write.js";

describe("Claude Code Write tool", () => {
    it("writes a file through the agent context fs", async () => {
        const harness = createJustBashToolHarness();

        const result = await harness.runTool(claudeWriteTool, {
            file_path: "/workspace/write.txt",
            content: "written",
        });

        expect(result.text).toContain("File created successfully");
        expect(await harness.readFile("/workspace/write.txt")).toBe("written");
    });

    it("rejects overwriting an existing file that was never read", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/existing.txt": "original\n" },
        });

        await expect(
            harness.runTool(claudeWriteTool, {
                file_path: "/workspace/existing.txt",
                content: "overwritten",
            }),
        ).rejects.toThrow(/has not been read yet/);
        expect(await harness.readFile("/workspace/existing.txt")).toBe("original\n");
    });

    it("allows overwriting after the file has been read", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/existing.txt": "original\n" },
        });
        await harness.runTool(claudeReadTool, { file_path: "/workspace/existing.txt" });

        const result = await harness.runTool(claudeWriteTool, {
            file_path: "/workspace/existing.txt",
            content: "overwritten",
        });

        expect(result.text).toContain("File updated successfully");
        expect(await harness.readFile("/workspace/existing.txt")).toBe("overwritten");
    });

    it("rejects writes when the file changed on disk after the read", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/existing.txt": "original\n" },
        });
        await harness.runTool(claudeReadTool, { file_path: "/workspace/existing.txt" });

        harness.context.fileReads?.recordRead("/workspace/existing.txt", 0);
        await harness.writeFile("/workspace/existing.txt", "changed externally\n");

        await expect(
            harness.runTool(claudeWriteTool, {
                file_path: "/workspace/existing.txt",
                content: "overwritten",
            }),
        ).rejects.toThrow(/modified since it was last read/);
    });

    it("allows consecutive writes without re-reading", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/existing.txt": "original\n" },
        });
        await harness.runTool(claudeReadTool, { file_path: "/workspace/existing.txt" });

        await harness.runTool(claudeWriteTool, {
            file_path: "/workspace/existing.txt",
            content: "first rewrite",
        });
        await harness.runTool(claudeWriteTool, {
            file_path: "/workspace/existing.txt",
            content: "second rewrite",
        });

        expect(await harness.readFile("/workspace/existing.txt")).toBe("second rewrite");
    });
});
