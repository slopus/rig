import { describe, expect, it } from "vitest";

import { formatToolResultForDisplay } from "./formatToolResultForDisplay.js";

describe("formatToolResultForDisplay", () => {
    it("explains model-generated tool errors without raw identifiers", () => {
        expect(
            formatToolResultForDisplay(
                "Unknown tool 'erase_everything' requested by model",
                "erase_everything",
            ),
        ).toBe(
            'The model requested "Erase everything", but that tool is not available in this session.',
        );
        expect(
            formatToolResultForDisplay("Invalid arguments for tool 'exec_command'", "exec_command"),
        ).toBe("The model supplied invalid information for Exec command.");
    });

    it("removes redundant raw tool prefixes while preserving the useful cause", () => {
        expect(
            formatToolResultForDisplay(
                "Tool 'apply_patch' failed: Invalid patch: hunk did not match",
                "apply_patch",
            ),
        ).toBe("Invalid patch: hunk did not match");
        expect(formatToolResultForDisplay("Interrupted by user.", "exec_command")).toBe(
            "Interrupted by user.",
        );
    });
});
