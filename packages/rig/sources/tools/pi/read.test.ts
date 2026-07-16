import { describe, expect, it, vi } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { validPng32Base64 } from "../testing/validImageFixtures.js";
import { piReadTool } from "./read.js";

describe("pi read tool", () => {
    it("reads text from the agent context fs", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/note.txt": "hello\nworld" },
        });

        const result = await harness.runTool(piReadTool, {
            path: "/workspace/note.txt",
            limit: 1,
        });

        expect("content" in result).toBe(true);
        if (!("content" in result)) return;
        expect(result.content).toBe("hello");
        expect(result.returnedLines).toBe(1);
        expect(result.truncated).toBe(true);
    });

    it("defaults to 2,000 lines and keeps the complete response within 50KB", async () => {
        const content = Array.from(
            { length: 2_001 },
            (_, index) => `${String(index + 1).padStart(4, "0")}-${"x".repeat(40)}`,
        ).join("\n");
        const harness = createJustBashToolHarness({
            files: { "/workspace/long.txt": content },
        });

        const result = await harness.runTool(piReadTool, { path: "/workspace/long.txt" });

        expect("content" in result).toBe(true);
        if (!("content" in result)) return;
        expect(result.returnedLines).toBeLessThanOrEqual(2_000);
        expect(result.truncated).toBe(true);
        expect(Buffer.byteLength(result.content, "utf8")).toBeLessThanOrEqual(50 * 1024);
        expect(result.content).toContain("Use offset=");
    });

    it("returns supported images as model attachments", async () => {
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/tiny.png": Buffer.from(validPng32Base64, "base64"),
            },
        });

        const result = await harness.runTool(piReadTool, { path: "/workspace/tiny.png" });

        expect(piReadTool.toLLM(result)).toEqual([
            {
                data: validPng32Base64,
                mediaType: "image/png",
                type: "image",
            },
        ]);
    });

    it("rejects oversized images before reading their contents", async () => {
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/large.png": Buffer.alloc(3.75 * 1024 * 1024 + 1),
            },
        });
        const readFileBuffer = vi.spyOn(harness.context.fs, "readFileBuffer");

        await expect(harness.runTool(piReadTool, { path: "/workspace/large.png" })).rejects.toThrow(
            "Image exceeds the supported 3.75MB size limit",
        );
        expect(readFileBuffer).not.toHaveBeenCalled();
    });
});
