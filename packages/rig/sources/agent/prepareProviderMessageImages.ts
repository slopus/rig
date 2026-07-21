import type { Message, ProviderImageProfile } from "../providers/types.js";
import { boundToolResultContent } from "./boundToolResultContent.js";
import { prepareProviderImageContent } from "./prepareProviderImageContent.js";

export async function prepareProviderMessageImages(
    messages: readonly Message[],
    profile: ProviderImageProfile = "codex",
): Promise<Message[]> {
    return Promise.all(
        messages.map(async (message) => {
            if (message.role === "assistant") {
                return message;
            }
            if (message.role === "user") {
                if (typeof message.content === "string") {
                    return message;
                }
                return {
                    ...message,
                    content: await Promise.all(
                        message.content.map((content) =>
                            prepareProviderImageContent(content, profile),
                        ),
                    ),
                };
            }
            const content = await Promise.all(
                message.content.map((item) => prepareProviderImageContent(item, profile)),
            );
            return {
                ...message,
                content: boundToolResultContent(content),
            };
        }),
    );
}
