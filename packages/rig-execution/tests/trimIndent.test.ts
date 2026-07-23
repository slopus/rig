import { describe, expect, it } from "vitest";

import { trimIndent } from "@/prompts/trimIndent.js";

describe("trimIndent", () => {
    it("matches Kotlin indentation and boundary-line behavior", () => {
        expect(
            trimIndent(`
                first
                  second

                third
            `),
        ).toBe("first\n  second\n\nthird");
    });

    it("keeps a blank line that is not the first or last input line", () => {
        expect(trimIndent("\n\n    value\n\n")).toBe("\nvalue\n");
    });

    it("returns an empty string when every line is blank", () => {
        expect(trimIndent("\n    \n")).toBe("");
    });
});
