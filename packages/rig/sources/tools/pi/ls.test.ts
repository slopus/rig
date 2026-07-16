import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { piLsTool } from "./ls.js";

describe("pi ls tool", () => {
    it("lists directory contents", async () => {
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/a.txt": "a",
                "/workspace/dir/b.txt": "b",
            },
        });

        const result = await harness.runTool(piLsTool, {
            path: "/workspace",
        });

        expect(result.text.split("\n")).toEqual(["a.txt", "dir/"]);
        expect(result).toMatchObject({ numEntries: 2, truncated: false });
    });

    it("lists dangling symbolic links without failing the directory", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/available.txt": "available" },
        });
        await harness.bash.fs.symlink("missing.txt", "/workspace/dangling.txt");

        const result = await harness.runTool(piLsTool, { path: "/workspace" });

        expect(result.text.split("\n")).toEqual(["available.txt", "dangling.txt"]);
    });

    it("marks listings truncated by the entry limit", async () => {
        const files = Object.fromEntries(
            Array.from({ length: 501 }, (_, index) => [
                `/workspace/file-${String(index).padStart(3, "0")}.txt`,
                "",
            ]),
        );
        const harness = createJustBashToolHarness({ files });

        const result = await harness.runTool(piLsTool, { path: "/workspace" });

        expect(result.text).toContain("... (directory listing truncated)");
        expect(result.text).not.toContain("file-500.txt");
        expect(result).toMatchObject({ numEntries: 500, truncated: true });
    });

    it("keeps the complete result within the advertised byte limit", async () => {
        const files = Object.fromEntries(
            Array.from({ length: 300 }, (_, index) => [
                `/workspace/file-${String(index).padStart(3, "0")}-${"x".repeat(180)}.txt`,
                "",
            ]),
        );
        const harness = createJustBashToolHarness({ files });

        const result = await harness.runTool(piLsTool, { path: "/workspace" });

        expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(50 * 1024);
        expect(result.text).toContain("... (directory listing truncated)");
        expect(result.numEntries).toBeLessThan(300);
        expect(result.truncated).toBe(true);
    });
});
