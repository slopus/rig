import { delayBeforeInferenceRetry } from "../delayBeforeInferenceRetry.js";
import { hasResponseContentBegun } from "../hasResponseContentBegun.js";
import { INFERENCE_MAX_RETRIES } from "../inferenceRetryPolicy.js";
import { isRetryableInferenceError } from "../isRetryableInferenceError.js";
import { selectCompactionSystemPromptForModel } from "./selectCompactionSystemPromptForModel.js";
import type {
    AssistantMessage,
    Context,
    Model,
    Provider,
    ServiceTier,
    StreamOptions,
} from "../../providers/types.js";

export async function requestCompactionSummary(options: {
    provider: Provider;
    model: Model;
    context: Context;
    signal?: AbortSignal;
    serviceTier?: ServiceTier;
    thinking?: string;
    now: () => number;
}): Promise<string> {
    const streamOptions: StreamOptions = {
        intent: "compaction",
        ...(options.serviceTier !== undefined ? { serviceTier: options.serviceTier } : {}),
        ...(options.thinking !== undefined ? { thinking: options.thinking } : {}),
    };
    if (options.signal !== undefined) streamOptions.signal = options.signal;

    const prompt = selectCompactionSystemPromptForModel(options.model);
    const timestamp = options.now();
    const context: Context = {
        ...options.context,
        messages: [...options.context.messages, { role: "user", content: prompt, timestamp }],
    };

    let response: AssistantMessage;
    let retryCount = 0;
    for (;;) {
        let responseContentBegun = false;
        try {
            const stream =
                options.provider.compact?.(options.model, options.context, {
                    ...streamOptions,
                    prompt,
                    timestamp,
                }) ?? options.provider.stream(options.model, context, streamOptions);
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
