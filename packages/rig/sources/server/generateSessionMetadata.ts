import type { Model, Provider, StreamOptions } from "@slopus/rig-execution";
import { toLocalDate } from "../executor/toLocalDate.js";

const METADATA_PROMPT = `Create settled session metadata from the visible conversation.

Return exactly one JSON object with exactly these string fields:
{"title":"...","recap":"..."}

Rules:
- title is 2 to 6 words and at most 80 characters
- recap is at most 2 sentences and 600 characters
- recap states the user's goal and the useful outcome or current state
- preserve the current title exactly unless the conversation clearly makes it misleading
- use only the supplied visible conversation; do not infer from hidden tool calls or reasoning
- return strict JSON with no markdown or commentary`;

export interface GeneratedSessionMetadata {
    recap: string;
    title: string;
}

export async function generateSessionMetadata(options: {
    currentTitle?: string;
    now?: () => number;
    provider: Provider;
    sessionId: string;
    signal?: AbortSignal;
    startDate?: string;
    transcript: string;
}): Promise<GeneratedSessionMetadata> {
    const now = options.now ?? Date.now;
    const timestamp = now();
    const model = selectMetadataModel(options.provider);
    const streamOptions: StreamOptions = {
        sessionId: `${options.sessionId}:title`,
        startDate: options.startDate ?? toLocalDate(timestamp),
        thinking: "off",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
    const stream = options.provider.stream(
        model,
        {
            systemPrompt: METADATA_PROMPT,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: [
                                `Current title: ${options.currentTitle ?? "(untitled)"}`,
                                "",
                                "Visible conversation:",
                                options.transcript,
                            ].join("\n"),
                        },
                    ],
                    timestamp,
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
    const text = message.content
        .filter((content) => content.type === "text")
        .map((content) => content.text)
        .join("")
        .trim();
    return parseSessionMetadata(text);
}

export function parseSessionMetadata(text: string): GeneratedSessionMetadata {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw new Error("Session metadata model returned invalid JSON.");
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Session metadata model did not return an object.");
    }
    const record = value as Record<string, unknown>;
    if (
        Object.keys(record).sort().join(",") !== "recap,title" ||
        typeof record.title !== "string" ||
        typeof record.recap !== "string"
    ) {
        throw new Error("Session metadata must contain only string title and recap fields.");
    }

    const title = normalizeLine(record.title);
    const titleWords = title.split(/\s+/u).filter(Boolean);
    if (title.length > 80 || titleWords.length < 2 || titleWords.length > 6) {
        throw new Error("Session metadata title must contain 2 to 6 words.");
    }

    const recap = normalizeLine(record.recap);
    const sentences = recap.split(/(?<=[.!?])\s+/u).filter(Boolean);
    if (recap.length === 0 || recap.length > 600 || sentences.length > 2) {
        throw new Error(
            "Session metadata recap must contain at most 2 sentences and 600 characters.",
        );
    }
    return { recap, title };
}

function normalizeLine(value: string): string {
    return value
        .replace(/[\r\n\t]+/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
}

function selectMetadataModel(provider: Provider): Model {
    const preferred =
        findModel(provider, "openai/gpt-5.6-sol") ??
        findModel(provider, "anthropic/fable-5") ??
        provider.models.at(-1);
    if (preferred === undefined) {
        throw new Error(`Provider '${provider.id}' has no models for session metadata generation.`);
    }
    return preferred;
}

function findModel(provider: Provider, id: string): Model | undefined {
    return provider.models.find((model) => model.id === id);
}
