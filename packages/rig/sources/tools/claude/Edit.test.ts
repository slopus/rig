import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { claudeEditTool } from "./Edit.js";
import { claudeReadTool } from "./Read.js";

describe("Claude Code Edit tool", () => {
    it("remains strict about exact text", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/edit.txt": "alpha  \nbeta\n" },
        });
        await harness.runTool(claudeReadTool, { file_path: "/workspace/edit.txt" });

        await expect(
            harness.runTool(claudeEditTool, {
                file_path: "/workspace/edit.txt",
                old_string: "alpha\nbeta",
                new_string: "gamma\nbeta",
            }),
        ).rejects.toThrow(/old_string was not found/);

        const result = await harness.runTool(claudeEditTool, {
            file_path: "/workspace/edit.txt",
            old_string: "alpha  \nbeta",
            new_string: "gamma\nbeta",
        });

        expect(result.replacements).toBe(1);
        expect(await harness.readFile("/workspace/edit.txt")).toBe("gamma\nbeta\n");
    });

    it("gives actionable guidance when the exact text is ambiguous", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/edit.txt": "same\nsame\n" },
        });
        await harness.runTool(claudeReadTool, { file_path: "/workspace/edit.txt" });

        const edit = harness.runTool(claudeEditTool, {
            file_path: "/workspace/edit.txt",
            old_string: "same",
            new_string: "changed",
        });

        await expect(edit).rejects.toThrow("include more surrounding context to make it unique");
        await expect(edit).rejects.not.toThrow("line_number");
    });
});
