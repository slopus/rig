import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const imagegen = {
    name: "imagegen",
    namespace: "image_gen",
    type: "cloud",
    description:
        "The `image_gen.imagegen` tool enables image generation from descriptions and editing of existing images based on specific instructions. Use it when:\n\n- The user requests an image based on a scene description, such as a diagram, portrait, comic, meme, or any other visual.\n- The user wants to modify an attached or previously generated image with specific changes, including adding or removing elements, altering colors, improving quality/resolution, or transforming the style (e.g., cartoon, oil painting).\n\nGuidelines:\n- imagegen needs a few minutes to finish. In code-mode, use the first-line @exec directive to give the initial call 120 seconds and the same yield for any waits that follow. Once it finishes, return the image with generatedImage(result).\n- Omit both `referenced_image_paths` and `num_last_images_to_include` when generating a brand new image.\n- For edits, use `referenced_image_paths` when every target image has a local file path.\n- If you have not seen a local image yet, use `view_image` to inspect it before editing.\n- Use `num_last_images_to_include` only when at least one target image has no local file path.\n- Set `num_last_images_to_include` to the smallest number of recent conversation images that includes every target image, up to 5.\n- Never provide both `referenced_image_paths` and `num_last_images_to_include`.\n- If neither mechanism can include every target image, ask the user to attach the missing images again.\n- Directly generate the image without reconfirmation or clarification unless required images must be attached again.\n- Always use this tool for image editing unless the user explicitly requests otherwise. Do not use the `python` tool for image editing unless specifically instructed.\n",
    parameters: Type.Object(
        {
            prompt: Type.String(),
            num_last_images_to_include: Type.Optional(Type.Unsafe({ type: ["integer", "null"] })),
            referenced_image_paths: Type.Optional(
                Type.Unsafe({
                    type: ["array", "null"],
                    items: {
                        type: "string",
                        description:
                            "A path that is guaranteed to be absolute and normalized (though it is not guaranteed to be canonicalized or exist on the filesystem).\n\nIMPORTANT: When deserializing an `AbsolutePathBuf`, a base path must be set using [AbsolutePathBufGuard::new]. If no base path is set, the deserialization will fail unless the path being deserialized is already absolute.",
                    },
                }),
            ),
        },
        { additionalProperties: false },
    ),
} as const satisfies SessionTool;
