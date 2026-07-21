import { describe, expect, it } from "vitest";

import { externalToolResolutionToContent } from "./externalToolResolutionToContent.js";

describe("externalToolResolutionToContent", () => {
    it("bounds restored external results that bypass normal tool execution", () => {
        const content = externalToolResolutionToContent({
            content: [{ type: "text", text: "x".repeat(100_000) }],
            output: null,
            status: "completed",
        });
        const text = content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("");

        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(50 * 1024);
        expect(text).toContain("truncated");
    });
});
