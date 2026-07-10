import { requestAnthropicMessage } from "../../../providers/requestAnthropicMessage.js";
import { makeWebFetchModelPrompt } from "./makeWebFetchModelPrompt.js";

export const MAX_WEB_FETCH_MARKDOWN_LENGTH = 100_000;

export async function applyPromptToMarkdown(
    prompt: string,
    markdown: string,
    signal: AbortSignal | undefined,
    isPreapprovedDomain: boolean,
): Promise<string> {
    const truncated =
        markdown.length > MAX_WEB_FETCH_MARKDOWN_LENGTH
            ? `${markdown.slice(0, MAX_WEB_FETCH_MARKDOWN_LENGTH)}\n\n[Content truncated due to length...]`
            : markdown;
    const response = await requestAnthropicMessage(
        {
            max_tokens: 4096,
            messages: [
                {
                    role: "user",
                    content: makeWebFetchModelPrompt(truncated, prompt, isPreapprovedDomain),
                },
            ],
            model: "claude-haiku-4-5-20251001",
            thinking: { type: "disabled" },
        },
        signal,
    );

    const text = response.content.find((block) => block.type === "text");
    return text?.text ?? "No response from model";
}
