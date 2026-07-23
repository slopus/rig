import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { createJustBashToolHarness } from "../../../tools/testing/createJustBashToolHarness.js";
import { validJpeg32Base64, validPng32Base64 } from "../../../tools/testing/validImageFixtures.js";
import { IMAGE_PROCESSING_ERROR_PLACEHOLDER } from "../../../tools/utils/index.js";
import { codexViewImageTool } from "../../tools/codex/view_image.js";

const validImageCases = [
    {
        name: "PNG",
        mediaType: "image/png",
        base64: validPng32Base64,
        misleadingPath: "/workspace/generated-image.jpg",
    },
    {
        name: "JPEG",
        mediaType: "image/jpeg",
        base64: validJpeg32Base64,
        misleadingPath: "/workspace/generated-image.png",
    },
] as const;

describe("codex view_image tool", () => {
    it.each(validImageCases)(
        "round-trips a valid generated $name by content rather than extension",
        async ({ mediaType, base64, misleadingPath }) => {
            const harness = createJustBashToolHarness();
            const originalBytes = Buffer.from(base64, "base64");
            await harness.context.fs.writeFile(misleadingPath, originalBytes);

            const result = await harness.runTool(codexViewImageTool, {
                path: misleadingPath,
                detail: "original",
            });

            expect(result).toEqual({
                detail: "original",
                image_url: `data:${mediaType};base64,${base64}`,
            });
            expect(Buffer.from(result.image_url.split(",")[1] ?? "", "base64")).toEqual(
                originalBytes,
            );
            expect(codexViewImageTool.toLLM(result)).toEqual([
                { type: "image", mediaType, data: base64, detail: "original" },
            ]);
        },
    );

    it("turns non-image bytes into a model-visible placeholder", async () => {
        const harness = createJustBashToolHarness();
        await harness.context.fs.writeFile(
            "/workspace/not-an-image.png",
            new TextEncoder().encode('{ "message": "hello" }'),
        );

        const result = await harness.runTool(codexViewImageTool, {
            path: "/workspace/not-an-image.png",
        });

        expect(result.image_url).toBe(IMAGE_PROCESSING_ERROR_PLACEHOLDER);
        expect(codexViewImageTool.toLLM(result)).toEqual([
            { type: "text", text: IMAGE_PROCESSING_ERROR_PLACEHOLDER },
        ]);
    });

    it("fully decodes images instead of trusting a valid-looking header", async () => {
        const harness = createJustBashToolHarness();
        const truncatedPng = Buffer.from(validPng32Base64, "base64").subarray(0, 33);
        await harness.context.fs.writeFile("/workspace/truncated.png", truncatedPng);

        const result = await harness.runTool(codexViewImageTool, {
            path: "/workspace/truncated.png",
        });

        expect(result.image_url).toBe(IMAGE_PROCESSING_ERROR_PLACEHOLDER);
    });

    it("resizes high-detail images while preserving original detail within Codex limits", async () => {
        const harness = createJustBashToolHarness();
        const input = await sharp({
            create: {
                width: 3000,
                height: 1000,
                channels: 3,
                background: { r: 10, g: 20, b: 30 },
            },
        })
            .png()
            .toBuffer();
        await harness.context.fs.writeFile("/workspace/large.png", input);

        const high = await harness.runTool(codexViewImageTool, {
            path: "/workspace/large.png",
        });
        const original = await harness.runTool(codexViewImageTool, {
            path: "/workspace/large.png",
            detail: "original",
        });
        const highBytes = Buffer.from(high.image_url.split(",")[1] ?? "", "base64");

        await expect(sharp(highBytes).metadata()).resolves.toMatchObject({
            format: "png",
            width: 2048,
            height: 683,
        });
        expect(original.image_url).toBe(`data:image/png;base64,${input.toString("base64")}`);
    });

    it("normalizes GIF input to a non-animated PNG", async () => {
        const harness = createJustBashToolHarness();
        const input = await sharp({
            create: {
                width: 16,
                height: 8,
                channels: 3,
                background: { r: 40, g: 50, b: 60 },
            },
        })
            .gif()
            .toBuffer();
        await harness.context.fs.writeFile("/workspace/input.gif", input);

        const result = await harness.runTool(codexViewImageTool, {
            path: "/workspace/input.gif",
            detail: "original",
        });
        const output = Buffer.from(result.image_url.split(",")[1] ?? "", "base64");

        expect(result.image_url).toMatch(/^data:image\/png;base64,/);
        await expect(sharp(output).metadata()).resolves.toMatchObject({
            format: "png",
            width: 16,
            height: 8,
        });
    });

    it("normalizes a decodable API-unsupported raster format to PNG", async () => {
        const harness = createJustBashToolHarness();
        const input = await sharp({
            create: {
                width: 12,
                height: 6,
                channels: 3,
                background: { r: 70, g: 80, b: 90 },
            },
        })
            .tiff()
            .toBuffer();
        await harness.context.fs.writeFile("/workspace/input.tiff", input);

        const result = await harness.runTool(codexViewImageTool, {
            path: "/workspace/input.tiff",
        });
        const output = Buffer.from(result.image_url.split(",")[1] ?? "", "base64");

        expect(result.image_url).toMatch(/^data:image\/png;base64,/);
        await expect(sharp(output).metadata()).resolves.toMatchObject({
            format: "png",
            width: 12,
            height: 6,
        });
    });

    it("preserves the filesystem error for a missing image", async () => {
        const harness = createJustBashToolHarness();

        await expect(
            harness.runTool(codexViewImageTool, {
                path: "/workspace/missing.png",
            }),
        ).rejects.toThrow(/ENOENT|no such file/i);
    });

    it("does not read an image that exceeds the local safety limit", async () => {
        const harness = createJustBashToolHarness();
        const readFileBuffer = vi.fn(async () => new Uint8Array());
        const context = {
            ...harness.context,
            fs: {
                ...harness.context.fs,
                readFileBuffer,
                stat: async () => ({
                    isFile: true,
                    isDirectory: false,
                    isSymbolicLink: false,
                    size: 32 * 1024 * 1024 + 1,
                    mtimeMs: 0,
                }),
            },
        };

        const result = await codexViewImageTool.execute(
            { path: "/workspace/too-large.png" },
            context,
            {},
        );

        expect(result.image_url).toBe(IMAGE_PROCESSING_ERROR_PLACEHOLDER);
        expect(readFileBuffer).not.toHaveBeenCalled();
    });
});
