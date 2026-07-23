import { selectCompactionSystemPromptForModel } from "./selectCompactionSystemPromptForModel.js";
import type {
    AssistantMessage,
    Context,
    Model,
    Provider,
    ServiceTier,
    StreamOptions,
} from "@slopus/rig-execution";
import { Executor } from "@slopus/rig-execution";
import { toLocalDate } from "../../executor/toLocalDate.js";

export async function requestCompactionSummary(options: {
    provider: Provider;
    model: Model;
    context: Context;
    signal?: AbortSignal;
    serviceTier?: ServiceTier;
    startDate?: string;
    thinking?: string;
    now: () => number;
}): Promise<string> {
    const startDate =
        options.startDate ??
        toLocalDate(options.context.messages.at(0)?.timestamp ?? options.now());
    const streamOptions: StreamOptions = {
        intent: "compaction",
        startDate,
        ...(options.serviceTier !== undefined ? { serviceTier: options.serviceTier } : {}),
        ...(options.thinking !== undefined ? { thinking: options.thinking } : {}),
    };
    if (options.signal !== undefined) streamOptions.signal = options.signal;

    const prompt = selectCompactionSystemPromptForModel(options.model);
    if (options.provider instanceof Executor && options.provider.hasActiveSession) {
        const result = await options.provider.compact({
            instructions: prompt,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        if (result.status === "cancelled") {
            throw new Error("Conversation compaction was stopped.");
        }
        if (result.status === "failed") throw new Error(result.message);
        const summary = result.summary?.trim() || result.compaction?.content.trim();
        if (summary === undefined || summary.length === 0) {
            throw new Error("The model returned an empty conversation summary.");
        }
        return summary;
    }
    const timestamp = options.now();
    const context: Context = {
        ...options.context,
        messages: [...options.context.messages, { role: "user", content: prompt, timestamp }],
    };

    const stream = options.provider.stream(options.model, context, streamOptions);
    for await (const _event of stream) {
        if (options.signal?.aborted) {
            throw new Error("Conversation compaction was stopped.");
        }
    }
    const response: AssistantMessage = await stream.result();

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
