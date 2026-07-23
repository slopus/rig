import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const image_edit = {
    name: "image_edit",
    type: "local",
    description:
        'Edit or transform existing image(s) via the xAI Imagine API; use instead of image_gen for image-to-image work (preserve likeness, transfer style, remix). Returns the saved image\'s absolute path. When telling the user where it was saved, refer to it by its short session-relative path (e.g. `images/1.jpg`) rather than the absolute path, so it renders as a clickable link that opens the image. Each required `image` is one reference — a user-attachment token (e.g. "[Image #1]"), an absolute filesystem path, or a `data:image/...;base64,...` URL (see the `image` parameter for the resolution order and details).',
    parameters: Type.Object(
        {
            prompt: Type.String({
                description:
                    "A text description of the desired edit or transformation. Describe what the output image should look like, referencing the input image(s).",
            }),
            image: Type.Array(Type.String({}), {
                description:
                    'Reference image(s) to condition the edit on. Each is one reference, in priority order: (1) a user attachment — its placeholder token, e.g. "[Image #1]" (attachments have no path you can see, so never invent one); (2) an absolute filesystem path the user gave you; (3) a `data:image/...;base64,...` URL.',
            }),
            aspect_ratio: Type.Optional(
                Type.String({
                    description:
                        "The aspect ratio of the output image. For single-image edits this is ignored — the output matches the input image's aspect ratio. For multi-image edits, defaults to 'auto'. Supported values: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2, 19.5:9, 9:19.5, 20:9, 9:20, auto.",
                    default: "auto",
                }),
            ),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "ImageEditInput",
        },
    ),
} as const satisfies SessionTool;
