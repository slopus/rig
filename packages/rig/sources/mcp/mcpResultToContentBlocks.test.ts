import { describe, expect, it } from "vitest";

import { mcpResultToContentBlocks } from "./mcpResultToContentBlocks.js";

describe("mcpResultToContentBlocks", () => {
    it("represents a successful empty result explicitly", () => {
        expect(mcpResultToContentBlocks({ content: [] })).toEqual([
            { type: "text", text: "(empty result)" },
        ]);
    });

    it("bounds text bytes and stops traversing oversized content arrays", () => {
        let highestReadIndex = -1;
        const content = new Proxy([], {
            get(_target, property) {
                if (property === "length") return 1_000_000;
                if (typeof property === "string" && /^\d+$/u.test(property)) {
                    highestReadIndex = Math.max(highestReadIndex, Number(property));
                    return { text: "🔥".repeat(10_000), type: "text" };
                }
                return undefined;
            },
        });

        const blocks = mcpResultToContentBlocks({ content });
        const text = blocks
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("");

        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(512 * 1024);
        expect(text).toContain("[truncated]");
        expect(highestReadIndex).toBeLessThan(128);
    });

    it("does not forward oversized image payloads to the model", () => {
        const blocks = mcpResultToContentBlocks({
            content: [
                {
                    data: "a".repeat(6 * 1024 * 1024),
                    mimeType: "image/png",
                    type: "image",
                },
            ],
        });

        expect(blocks).toEqual([
            { type: "text", text: "The MCP tool returned an image that exceeded the size limit." },
        ]);
    });

    it("bounds structured content without traversing the entire value", () => {
        let highestReadIndex = -1;
        const items = new Proxy([], {
            get(_target, property) {
                if (property === "length") return 1_000_000;
                if (typeof property === "string" && /^\d+$/u.test(property)) {
                    highestReadIndex = Math.max(highestReadIndex, Number(property));
                    return Number(property);
                }
                return undefined;
            },
        });

        const blocks = mcpResultToContentBlocks({ structuredContent: { items } });

        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toMatchObject({ type: "text" });
        if (blocks[0]?.type !== "text") throw new Error("Expected bounded text content.");
        expect(Buffer.byteLength(blocks[0].text)).toBeLessThanOrEqual(512 * 1024);
        expect(blocks[0].text).toContain("[truncated]");
        expect(highestReadIndex).toBeLessThan(200);
    });
});
