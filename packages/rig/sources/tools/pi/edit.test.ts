import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { piEditTool } from "./edit.js";
import { piReadTool } from "./read.js";

describe("pi edit tool", () => {
    it("supports PI fuzzy batch edits", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/sample.txt": "alpha  \nbeta\nthree\n" },
        });
        await harness.runTool(piReadTool, { path: "/workspace/sample.txt" });

        const result = await harness.runTool(piEditTool, {
            path: "/workspace/sample.txt",
            edits: [
                { oldText: "alpha\nbeta", newText: "gamma\nbeta" },
                { oldText: "three", newText: "THREE" },
            ],
        });

        expect(result).toMatchObject({ replacements: 2, fuzzy: true });
        expect(await harness.readFile("/workspace/sample.txt")).toBe("gamma\nbeta\nTHREE\n");
    });

    it("rejects an empty oldText without changing the file", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/sample.txt": "unchanged\n" },
        });
        await harness.runTool(piReadTool, { path: "/workspace/sample.txt" });

        await expect(
            harness.runTool(piEditTool, {
                path: "/workspace/sample.txt",
                edits: [{ oldText: "", newText: "replacement" }],
            }),
        ).rejects.toThrow("oldText for edit 1 must not be empty.");
        expect(await harness.readFile("/workspace/sample.txt")).toBe("unchanged\n");
    });

    it("gives actionable guidance when fuzzy text is ambiguous", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/sample.txt": "alpha  \nbeta\nmiddle\nalpha  \nbeta\n" },
        });
        await harness.runTool(piReadTool, { path: "/workspace/sample.txt" });

        const edit = harness.runTool(piEditTool, {
            path: "/workspace/sample.txt",
            edits: [{ oldText: "alpha\nbeta", newText: "gamma\nbeta" }],
        });

        await expect(edit).rejects.toThrow("include more surrounding context to make it unique");
        await expect(edit).rejects.not.toThrow("line_number");
    });
});
