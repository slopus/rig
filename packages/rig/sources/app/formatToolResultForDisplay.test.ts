import { describe, expect, it } from "vitest";

import { formatToolResultForDisplay } from "./formatToolResultForDisplay.js";

describe("formatToolResultForDisplay", () => {
    it("explains model-generated tool errors without raw identifiers", () => {
        expect(
            formatToolResultForDisplay({
                display: "Requested tool is unavailable.",
                failure: { kind: "tool_unavailable" },
                toolName: "erase_everything",
            }),
        ).toBe(
            'The model requested "Erase everything", but that tool is not available in this session.',
        );
        expect(
            formatToolResultForDisplay({
                display: "The request could not be validated.",
                failure: { kind: "invalid_arguments" },
                toolName: "exec_command",
            }),
        ).toBe("The model supplied invalid information for Exec command.");
    });

    it("removes redundant raw tool prefixes while preserving the useful cause", () => {
        expect(
            formatToolResultForDisplay({
                display: "Apply patch failed.",
                failure: {
                    kind: "execution_failed",
                    message: "Invalid patch: hunk did not match",
                },
                toolName: "apply_patch",
            }),
        ).toBe("Invalid patch: hunk did not match");
        expect(
            formatToolResultForDisplay({
                display: "Cancelled at the user's request.",
                failure: { kind: "interrupted" },
                toolName: "exec_command",
            }),
        ).toBe("Cancelled at the user's request.");
    });
});
