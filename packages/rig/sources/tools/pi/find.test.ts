import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { piFindTool } from "./find.js";

describe("pi find tool", () => {
    it("returns paths relative to the search directory and respects .gitignore", async () => {
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/.git/HEAD": "ref: refs/heads/main\n",
                "/workspace/.gitignore": "src/ignored.txt\n",
                "/workspace/src/ignored.txt": "ignored",
                "/workspace/src/visible.txt": "visible",
            },
        });

        const result = await harness.runTool(piFindTool, {
            pattern: "*.txt",
            path: "/workspace/src",
        });

        expect(result.text).toBe("visible.txt");
    });

    it("truncates output at 50KB and reports the limit", async () => {
        const files = Object.fromEntries(
            Array.from({ length: 1_000 }, (_, index) => [
                `/workspace/${String(index).padStart(4, "0")}-${"long-name-".repeat(7)}.txt`,
                "content",
            ]),
        );
        const harness = createJustBashToolHarness({ files });

        const result = await harness.runTool(piFindTool, { pattern: "*.txt" });

        expect(Buffer.byteLength(result.text, "utf8")).toBeLessThan(51 * 1024);
        expect(result.text).toContain("50KB limit reached");
        expect(result.text).not.toContain("/workspace/");
    });
});
