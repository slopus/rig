import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const image_gen = {
    name: "image_gen",
    type: "local",
    description:
        "Generate a new image from a text description using Imagine; returns the saved image's absolute path. When telling the user where it was saved, refer to it by its short session-relative path (e.g. `images/1.jpg`) rather than the absolute path, so it renders as a clickable link that opens the image. To produce multiple images, emit multiple tool calls with distinct prompts.",
    parameters: Type.Object(
        {
            prompt: Type.String({
                description: "Text description of the image to generate.",
            }),
            aspect_ratio: Type.Optional(
                Type.String({
                    description:
                        "Aspect ratio of the generated image, decide it based on the user's request. Defaults to 'auto'. 1:1 for square (icons, profiles), 16:9 for wide (landscapes, cinematic), 9:16 for tall (phone wallpapers, stories), 3:2 for horizontal photos, 2:3 for vertical (portraits, posters).",
                    default: "auto",
                }),
            ),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "ImageGenInput",
        },
    ),
} as const satisfies SessionTool;
