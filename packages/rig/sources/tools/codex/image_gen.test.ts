import { describe, expect, it, vi } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { validPng32Base64 } from "../testing/validImageFixtures.js";
import { createCodexImageGenerationTool } from "./image_gen.js";

describe("codex image generation tool", () => {
    it("persists and returns generated image content to the model", async () => {
        const harness = createJustBashToolHarness();
        const generateImage = vi.fn(async () => ({
            data: validPng32Base64,
            mediaType: "image/png" as const,
            revisedPrompt: "A revised prompt",
        }));
        const tool = createCodexImageGenerationTool(generateImage);

        const result = await tool.execute({ prompt: "A small diagram" }, harness.context, {
            toolCallId: "call/1",
        });

        expect(generateImage).toHaveBeenCalledWith("A small diagram", {});
        expect(result.path).toBe("/workspace/.rig/generated-images/call_1.png");
        expect(await harness.context.fs.readFileBuffer(result.path)).toEqual(
            Buffer.from(validPng32Base64, "base64"),
        );
        expect(tool.toLLM(result)).toEqual([
            { type: "text", text: `Generated image saved to ${result.path}` },
            { type: "image", data: validPng32Base64, mediaType: "image/png" },
        ]);
    });

    it("propagates generation failures without writing an output artifact", async () => {
        const harness = createJustBashToolHarness();
        const tool = createCodexImageGenerationTool(async () => {
            throw new Error("image service unavailable");
        });

        await expect(
            tool.execute({ prompt: "A small diagram" }, harness.context, { toolCallId: "failed" }),
        ).rejects.toThrow("image service unavailable");
        await expect(
            harness.context.fs.exists("/workspace/.rig/generated-images/failed.png"),
        ).resolves.toBe(false);
    });
});
