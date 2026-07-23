import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const view_image = {
    name: "view_image",
    type: "local",
    description:
        "View a local image file from the filesystem when visual inspection is needed. Use this for images already available on disk.",
    parameters: Type.Object(
        {
            path: Type.String({ description: "Local filesystem path to an image file." }),
            detail: Type.Optional(
                Type.String({
                    description:
                        "Image detail level. Defaults to `high`; use `original` to preserve exact resolution.",
                    enum: ["high", "original"],
                }),
            ),
        },
        { additionalProperties: false },
    ),
} as const satisfies SessionTool;
