import { describe, expect, it } from "vitest";

import { boundToolResultContent } from "./boundToolResultContent.js";

describe("boundToolResultContent", () => {
    it("counts an image removed to make room for the truncation notice", () => {
        const bounded = boundToolResultContent(
            [
                { type: "image", data: "oversized", mimeType: "image/png" },
                { type: "text", text: "kept" },
                { type: "image", data: "ok", mimeType: "image/png" },
            ],
            {
                maximumBlocks: 2,
                maximumImageBase64Bytes: 4,
                maximumImageBlocks: 2,
            },
        );

        expect(bounded).toEqual([
            { type: "text", text: "kept" },
            {
                type: "text",
                text: "[2 tool-result images were omitted because the image size or count limit was exceeded.]",
            },
        ]);
    });
});
