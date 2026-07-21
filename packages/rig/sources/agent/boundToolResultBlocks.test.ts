import { describe, expect, it } from "vitest";

import { boundToolResultBlocks } from "./boundToolResultBlocks.js";
import type { ToolResultBlock } from "./types.js";

describe("boundToolResultBlocks", () => {
    it("caps the combined text and images from a parallel tool-result batch", () => {
        const blocks = Array.from(
            { length: 5 },
            (_, index): ToolResultBlock => ({
                type: "tool_result",
                toolCallId: `call-${String(index)}`,
                toolName: "test_tool",
                rendered: [
                    { type: "text", text: `${String(index)}-${"x".repeat(50 * 1024)}` },
                    { type: "image", data: "a", mediaType: "image/png" },
                ],
                display: "Test output",
            }),
        );

        const bounded = boundToolResultBlocks(blocks);
        const textBytes = bounded.reduce(
            (total, block) =>
                total +
                block.rendered.reduce(
                    (blockTotal, rendered) =>
                        blockTotal +
                        (rendered.type === "text" ? Buffer.byteLength(rendered.text) : 0),
                    0,
                ),
            0,
        );
        const imageCount = bounded.reduce(
            (total, block) =>
                total + block.rendered.filter((rendered) => rendered.type === "image").length,
            0,
        );

        expect(textBytes).toBeLessThanOrEqual(200 * 1024);
        expect(imageCount).toBeLessThanOrEqual(4);
        expect(bounded.map((block) => block.toolCallId)).toEqual(
            blocks.map((block) => block.toolCallId),
        );
        expect(bounded).toContainEqual(
            expect.objectContaining({
                rendered: expect.arrayContaining([
                    expect.objectContaining({
                        type: "text",
                        text: expect.stringContaining("truncated"),
                    }),
                ]),
            }),
        );
    });
});
