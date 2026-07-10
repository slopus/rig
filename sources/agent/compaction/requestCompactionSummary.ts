import { formatMessagesForCompaction } from "./formatMessagesForCompaction.js";
import type { Message } from "../types.js";
import type { Model, Provider, StreamOptions } from "../../providers/types.js";

const COMPACTION_SYSTEM_PROMPT = `Create a detailed continuation brief for a coding agent that will continue this conversation without access to the original history.

Preserve the user's requests and constraints, important technical facts, decisions and rationale, files examined or changed, concrete edits, commands and test results, errors and fixes, and all unfinished work. Distinguish completed work from pending work. Include exact identifiers, paths, and short code fragments when they are needed to continue accurately. Do not continue the work or address the user. Return only the continuation brief.`;

export async function requestCompactionSummary(options: {
    provider: Provider;
    model: Model;
    messages: readonly Message[];
    effort?: string;
    signal?: AbortSignal;
    now: () => number;
}): Promise<string> {
    const streamOptions: StreamOptions = {};
    if (options.effort !== undefined) streamOptions.thinking = options.effort;
    if (options.signal !== undefined) streamOptions.signal = options.signal;

    const stream = options.provider.stream(
        options.model,
        {
            systemPrompt: COMPACTION_SYSTEM_PROMPT,
            messages: [
                {
                    role: "user",
                    content: formatMessagesForCompaction(options.messages),
                    timestamp: options.now(),
                },
            ],
            tools: [],
        },
        streamOptions,
    );

    for await (const _event of stream) {
        if (options.signal?.aborted) {
            throw new Error("Conversation compaction was stopped.");
        }
    }

    const response = await stream.result();
    if (response.stopReason === "aborted") {
        throw new Error("Conversation compaction was stopped.");
    }
    if (response.stopReason === "error") {
        throw new Error(response.errorMessage ?? "The model could not compact this conversation.");
    }

    const summary = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
    if (summary.length === 0) {
        throw new Error("The model returned an empty conversation summary.");
    }
    return summary;
}
