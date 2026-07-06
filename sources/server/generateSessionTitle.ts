import type { Model, Provider, StreamOptions } from "../providers/types.js";

const TITLE_PROMPT =
    "Create a concise session title from the user's first message. Return only the title, no quotes, no punctuation-only suffix, no markdown. Use 2 to 6 words.";

export async function generateSessionTitle(options: {
    firstMessage: string;
    now?: () => number;
    provider: Provider;
    sessionId: string;
}): Promise<string> {
    const now = options.now ?? Date.now;
    const model = selectTitleModel(options.provider);
    const streamOptions: StreamOptions = {
        sessionId: `${options.sessionId}:title`,
        thinking: "off",
    };
    const stream = options.provider.stream(
        model,
        {
            systemPrompt: TITLE_PROMPT,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: options.firstMessage,
                        },
                    ],
                    timestamp: now(),
                },
            ],
            tools: [],
        },
        streamOptions,
    );

    for await (const _event of stream) {
        // Drain the stream; the normalized final message is read below.
    }

    const message = await stream.result();
    const title = cleanTitle(
        message.content
            .filter((content) => content.type === "text")
            .map((content) => content.text)
            .join(" "),
    );
    if (title.length === 0) {
        throw new Error("Title model returned an empty title.");
    }
    return title;
}

function cleanTitle(text: string): string {
    return text
        .replace(/[\r\n\t]+/g, " ")
        .replace(/^#+\s*/, "")
        .replace(/^["'`]+|["'`.!?:;,\s]+$/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80)
        .trim();
}

function selectTitleModel(provider: Provider): Model {
    const preferred =
        findModel(provider, "openai/gpt-5.4") ??
        findModel(provider, "anthropic/haiku-4-5") ??
        provider.models.at(-1);
    if (preferred === undefined) {
        throw new Error(`Provider '${provider.id}' has no models for title generation.`);
    }
    return preferred;
}

function findModel(provider: Provider, id: string): Model | undefined {
    return provider.models.find((model) => model.id === id);
}
