import type { Model, Provider } from "@slopus/rig-execution";
import { makeWebFetchModelPrompt } from "./makeWebFetchModelPrompt.js";

export const MAX_WEB_FETCH_MARKDOWN_LENGTH = 100_000;

export async function applyPromptToMarkdown(
    prompt: string,
    markdown: string,
    provider: Provider,
    model: Model,
    signal: AbortSignal | undefined,
    isPreapprovedDomain: boolean,
): Promise<string> {
    const truncated =
        markdown.length > MAX_WEB_FETCH_MARKDOWN_LENGTH
            ? `${markdown.slice(0, MAX_WEB_FETCH_MARKDOWN_LENGTH)}\n\n[Content truncated due to length...]`
            : markdown;
    const auxiliaryProvider = provider as Provider & {
        runClaudeAuxiliaryQuery?: (
            model: Model,
            request: {
                prompt: string;
                signal?: AbortSignal;
                systemPrompt: string;
                tools?: readonly "WebSearch"[];
            },
        ) => Promise<{ content: readonly unknown[] }>;
    };
    if (auxiliaryProvider.runClaudeAuxiliaryQuery === undefined) {
        throw new Error(
            `The selected provider '${provider.id}' does not support Claude web helper inference.`,
        );
    }
    const response = await auxiliaryProvider.runClaudeAuxiliaryQuery(model, {
        prompt: makeWebFetchModelPrompt(truncated, prompt, isPreapprovedDomain),
        ...(signal === undefined ? {} : { signal }),
        systemPrompt: "",
    });

    const text = response.content.find(isTextBlock);
    return text?.text ?? "No response from model";
}

function isTextBlock(value: unknown): value is { type: "text"; text: string } {
    return (
        typeof value === "object" &&
        value !== null &&
        "type" in value &&
        value.type === "text" &&
        "text" in value &&
        typeof value.text === "string"
    );
}
