import type { ProviderImageProfile, ToolResultContent, UserContent } from "@slopus/rig-execution";
import {
    IMAGE_PROCESSING_ERROR_PLACEHOLDER,
    ImageProcessingError,
    prepareImageForClaude,
    prepareImageForPrompt,
} from "../images/index.js";

export async function prepareProviderImageContent(
    content: UserContent | ToolResultContent,
    profile: ProviderImageProfile = "codex",
): Promise<UserContent | ToolResultContent> {
    if (content.type === "text") {
        return content;
    }

    try {
        const bytes = Buffer.from(content.data, "base64");
        const image =
            profile === "claude"
                ? await prepareImageForClaude(bytes)
                : await prepareImageForPrompt(bytes, content.detail ?? "high");
        return {
            type: "image",
            data: image.bytes.toString("base64"),
            mimeType: image.mediaType,
            ...(content.detail !== undefined ? { detail: content.detail } : {}),
        };
    } catch (error) {
        if (error instanceof ImageProcessingError) {
            return {
                type: "text",
                text: IMAGE_PROCESSING_ERROR_PLACEHOLDER,
            };
        }
        throw error;
    }
}
