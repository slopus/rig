import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const image_to_video = {
    name: "image_to_video",
    type: "local",
    description:
        'Generate a video from a single source image; returns the saved video\'s absolute path. When telling the user where it was saved, refer to it by its short session-relative path (e.g. `videos/1.mp4`) rather than the absolute path, so it renders as a clickable link that opens the video. Provide `image` for the image to animate and optionally a `prompt` to guide the animation. Use this tool when the user provides an image and wants it animated, turned into a video, or used as the first frame. Example: image_to_video(image="/Users/me/photo.jpg", prompt="gentle camera push-in with wind moving the hair", duration=6, resolution_name="480p")',
    parameters: Type.Object(
        {
            prompt: Type.Optional(
                Type.Unsafe({
                    description:
                        "Optional prompt to guide the video generation model. If omitted, a natural animation applies automatically.",
                    type: ["string", "null"],
                    default: null,
                }),
            ),
            image: Type.String({
                description:
                    "Source image to animate. Provide an absolute filesystem path, HTTPS URL, or `data:image/...;base64,...` URL.",
            }),
            duration: Type.Optional(
                Type.Unsafe({
                    description:
                        "Duration of the video generation, either 6 or 10 seconds. Default to 6 unless the user requests longer.",
                    type: ["integer", "null"],
                    format: "uint32",
                    minimum: 0,
                }),
            ),
            resolution_name: Type.Optional(
                Type.String({
                    description:
                        "Resolution name of the video generation, only specify it when user asks for a specific resolution, either 480p or 720p. Defaults to 480p unless the user specifically requests for higher quality.",
                    default: "480p",
                }),
            ),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "ImageToVideoInput",
        },
    ),
} as const satisfies SessionTool;
