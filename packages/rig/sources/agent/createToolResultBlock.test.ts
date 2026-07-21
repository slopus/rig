import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";

import { defineTool, type ContentBlock } from "./types.js";
import { createErrorToolResultBlock } from "./createErrorToolResultBlock.js";
import { createToolResultBlock } from "./createToolResultBlock.js";

const MAXIMUM_TEXT_BYTES = 50 * 1024;
const MAXIMUM_IMAGE_BLOCKS = 4;
const MAXIMUM_RESULT_BLOCKS = 128;
const MAXIMUM_IMAGE_BASE64_BYTES = 5 * 1024 * 1024;

describe("createToolResultBlock", () => {
    it("caps aggregate model-facing text across every tool result", () => {
        const block = createToolResultBlock(
            toolReturning([
                { type: "text", text: `first-${"a".repeat(40_000)}` },
                { type: "text", text: `second-${"b".repeat(40_000)}` },
            ]),
            {},
            {},
            "call-1",
        );

        const bytes = block.rendered.reduce(
            (total, rendered) =>
                total + (rendered.type === "text" ? Buffer.byteLength(rendered.text) : 0),
            0,
        );
        expect(bytes).toBeLessThanOrEqual(MAXIMUM_TEXT_BYTES);
        expect(block.rendered).toContainEqual(
            expect.objectContaining({ type: "text", text: expect.stringContaining("truncated") }),
        );
    });

    it("caps model-facing image sizes, image counts, and total block counts", () => {
        const blocks: ContentBlock[] = [
            {
                type: "image",
                data: "a".repeat(MAXIMUM_IMAGE_BASE64_BYTES + 1),
                mediaType: "image/png",
            },
            ...Array.from(
                { length: 150 },
                (_, index): ContentBlock =>
                    index < 10
                        ? { type: "image", data: "a", mediaType: "image/png" }
                        : { type: "text", text: String(index) },
            ),
        ];

        const block = createToolResultBlock(toolReturning(blocks), {}, {}, "call-2");

        expect(block.rendered.length).toBeLessThanOrEqual(MAXIMUM_RESULT_BLOCKS);
        expect(block.rendered.filter((rendered) => rendered.type === "image")).toHaveLength(
            MAXIMUM_IMAGE_BLOCKS,
        );
        expect(block.rendered).toContainEqual(
            expect.objectContaining({ type: "text", text: expect.stringContaining("image") }),
        );
        expect(block.rendered).toContainEqual(
            expect.objectContaining({ type: "text", text: expect.stringContaining("truncated") }),
        );
    });
});

describe("createErrorToolResultBlock", () => {
    it("caps thrown tool errors before they become model context", () => {
        const message = `failure-${"x".repeat(100_000)}`;
        const block = createErrorToolResultBlock({ id: "call-3", name: "unsafe_tool" }, message, {
            kind: "execution_failed",
            message,
        });
        const renderedText = block.rendered
            .filter((rendered) => rendered.type === "text")
            .map((rendered) => rendered.text)
            .join("");

        expect(Buffer.byteLength(renderedText)).toBeLessThanOrEqual(MAXIMUM_TEXT_BYTES);
        expect(renderedText).toContain("truncated");
        expect(Buffer.byteLength(block.display)).toBeLessThanOrEqual(MAXIMUM_TEXT_BYTES);
        expect(Buffer.byteLength(block.failure?.message ?? "")).toBeLessThanOrEqual(
            MAXIMUM_TEXT_BYTES,
        );
    });
});

function toolReturning(blocks: readonly ContentBlock[]) {
    return defineTool({
        name: "test_tool",
        label: "Test tool",
        description: "Returns test content.",
        arguments: Type.Object({}),
        returnType: Type.Object({}),
        shouldReviewInAutoMode: () => false,
        execute: () => ({}),
        toLLM: () => blocks,
        toUI: () => "Test output",
        locks: [],
    });
}
