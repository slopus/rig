import { join } from "node:path";

import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import type { Provider } from "../../providers/types.js";

const DESCRIPTION = `Generate an image from a detailed text description. Use this when the user requests a diagram, portrait, comic, meme, or any other visual. Directly generate the image without reconfirmation unless essential details are missing.`;

export function createCodexImageGenerationTool(
    generateImage: NonNullable<Provider["generateImage"]>,
) {
    return defineTool({
        name: "image_gen",
        label: "image_gen",
        description: DESCRIPTION,
        arguments: Type.Object(
            {
                prompt: Type.String({
                    description: "Detailed description of the image to generate.",
                }),
            },
            { additionalProperties: false },
        ),
        returnType: Type.Object({
            data: Type.String(),
            mediaType: Type.Literal("image/png"),
            path: Type.String(),
            revisedPrompt: Type.Optional(Type.String()),
        }),
        execute: async ({ prompt }, context, options) => {
            const image = await generateImage(
                prompt,
                options.signal === undefined ? {} : { signal: options.signal },
            );
            const callId = options.toolCallId?.replaceAll(/[^a-zA-Z0-9_-]/g, "_") ?? "image";
            const directory = join(context.fs.cwd, ".rig", "generated-images");
            const path = join(directory, `${callId}.png`);
            await context.fs.mkdir(directory, { recursive: true });
            await context.fs.writeFile(path, Buffer.from(image.data, "base64"));
            return { ...image, path };
        },
        toLLM: ({ data, mediaType, path }) => [
            { type: "text", text: `Generated image saved to ${path}` },
            { type: "image", data, mediaType },
        ],
        toUI: ({ path }) => `Generated image ${path}`,
        shouldReviewInAutoMode: () => true,
        locks: ["codex-image-generation"],
    });
}
