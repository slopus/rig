import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const reference_to_video = {
    name: "reference_to_video",
    type: "local",
    description:
        'Generate a video from multiple reference images guided by a text prompt; returns the saved video\'s absolute path. When telling the user where it was saved, refer to it by its short session-relative path (e.g. `videos/1.mp4`) rather than the absolute path, so it renders as a clickable link that opens the video. Provide `images` with 2 to 7 image references and a required `prompt` describing the desired video. Use this tool when the user wants a video using multiple images as style/content references. Example: reference_to_video(prompt="blend these into a cinematic fashion shot with slow dolly movement", images=["/Users/me/ref1.jpg", "/Users/me/ref2.jpg"], aspect_ratio="16:9", duration=6, resolution_name="480p")',
    parameters: Type.Object(
        {
            prompt: Type.String({
                description:
                    "Prompt to guide the video generation model. Describe the desired video.",
            }),
            images: Type.Array(Type.String({}), {
                description:
                    "Reference images. Provide 2 to 7 entries; the images are used as style/content references for the generated video. Each entry may be an absolute filesystem path, HTTPS URL, or `data:image/...;base64,...` URL.",
            }),
            aspect_ratio: Type.String({
                description:
                    "Aspect ratio of the generated video, decide it based on the user's request. 1:1 for square (icons, profiles), 16:9 for wide (landscapes, cinematic), 9:16 for tall (phone wallpapers, stories), 3:2 for horizontal photos, 2:3 for vertical (portraits, posters).",
            }),
            duration: Type.Optional(
                Type.Unsafe({
                    description:
                        "Duration of the video generation, either 6 or 10 seconds. Defaults to 6.",
                    type: ["integer", "null"],
                    format: "uint32",
                    minimum: 0,
                }),
            ),
            resolution_name: Type.Optional(
                Type.String({
                    description:
                        "Resolution name of the video generation, only specify it when user asks for a specific resolution, either 480p or 720p. Defaults to 480p.",
                    default: "480p",
                }),
            ),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "ReferenceToVideoInput",
        },
    ),
} as const satisfies SessionTool;
