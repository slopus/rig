import { formatMessagesForCompaction } from "./formatMessagesForCompaction.js";
import { delayBeforeInferenceRetry } from "../delayBeforeInferenceRetry.js";
import { hasResponseContentBegun } from "../hasResponseContentBegun.js";
import { INFERENCE_MAX_RETRIES } from "../inferenceRetryPolicy.js";
import { isRetryableInferenceError } from "../isRetryableInferenceError.js";
import type { Message } from "../types.js";
import type {
    AssistantMessage,
    Model,
    Provider,
    ServiceTier,
    StreamOptions,
} from "../../providers/types.js";

const COMPACTION_SYSTEM_PROMPT = `Create a detailed continuation brief for a coding agent that will continue this conversation without access to the original history.

Preserve the user's requests and constraints, important technical facts, decisions and rationale, files examined or changed, concrete edits, commands and test results, errors and fixes, and all unfinished work. Distinguish completed work from pending work. Include exact identifiers, paths, and short code fragments when they are needed to continue accurately. Do not continue the work or address the user. Return only the continuation brief.`;

export async function requestCompactionSummary(options: {
    provider: Provider;
    model: Model;
    messages: readonly Message[];
    signal?: AbortSignal;
    serviceTier?: ServiceTier;
    thinking?: string;
    now: () => number;
}): Promise<string> {
    const streamOptions: StreamOptions = {
        ...(options.serviceTier !== undefined ? { serviceTier: options.serviceTier } : {}),
        ...(options.thinking !== undefined ? { thinking: options.thinking } : {}),
    };
    if (options.signal !== undefined) streamOptions.signal = options.signal;

    const context = {
        systemPrompt: COMPACTION_SYSTEM_PROMPT,
        messages: [
            {
                role: "user" as const,
                content: formatMessagesForCompaction(options.messages),
                timestamp: options.now(),
            },
        ],
        tools: [],
    };

    let response: AssistantMessage;
    let retryCount = 0;
    for (;;) {
        let responseContentBegun = false;
        try {
            const stream = options.provider.stream(options.model, context, streamOptions);
            for await (const event of stream) {
                if (hasResponseContentBegun(event)) responseContentBegun = true;
                if (options.signal?.aborted) {
                    throw new Error("Conversation compaction was stopped.");
                }
            }
            response = await stream.result();
        } catch (error) {
            if (
                !responseContentBegun &&
                retryCount < INFERENCE_MAX_RETRIES &&
                isRetryableInferenceError(error)
            ) {
                retryCount += 1;
                await delayBeforeInferenceRetry(retryCount, options.signal);
                continue;
            }
            throw error;
        }

        if (
            !responseContentBegun &&
            response.stopReason === "error" &&
            retryCount < INFERENCE_MAX_RETRIES &&
            isRetryableInferenceError(response)
        ) {
            retryCount += 1;
            await delayBeforeInferenceRetry(retryCount, options.signal);
            continue;
        }
        break;
    }

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
