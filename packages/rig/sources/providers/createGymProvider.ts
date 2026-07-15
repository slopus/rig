import { createInferenceStream } from "./createInferenceStream.js";
import type { GymInferenceRequest, GymInferenceResponse } from "./gym-types.js";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type AssistantMessageEvent,
    type Model,
    type ServiceTier,
    type StreamOptions,
    type Usage,
} from "./types.js";

export const gymModel = defineModel({
    id: "openai/gym",
    name: "Gym",
    thinkingLevels: ["off", "low", "medium", "high"],
    defaultThinkingLevel: "off",
    contextWindow: 272_000,
});

export interface CreateGymProviderOptions {
    contextWindow?: number;
    endpoint: string;
    fetch?: typeof globalThis.fetch;
    models?: readonly Model[];
    providerId?: string;
    serviceTiers?: readonly ServiceTier[];
    token?: string;
}

export function createGymProvider(options: CreateGymProviderOptions) {
    const request = options.fetch ?? globalThis.fetch;
    const models = options.models ?? [gymModel];
    const providerId = options.providerId ?? "gym";
    const contextWindow = options.contextWindow;
    const configuredModels =
        contextWindow === undefined ? models : models.map((model) => ({ ...model, contextWindow }));
    return defineProvider({
        id: providerId,
        models: configuredModels,
        ...(options.providerId === undefined
            ? { serviceTiers: ["fast"] as const }
            : options.serviceTiers === undefined
              ? {}
              : { serviceTiers: options.serviceTiers }),
        stream(model, context, streamOptions = {}) {
            return createInferenceStream(async function* () {
                const response = await request(options.endpoint, {
                    body: JSON.stringify({
                        context,
                        modelId: model.id,
                        options: streamOptions,
                        providerId,
                    } satisfies GymInferenceRequest),
                    headers: {
                        "content-type": "application/json",
                        ...(options.token === undefined
                            ? {}
                            : { authorization: `Bearer ${options.token}` }),
                    },
                    method: "POST",
                    ...(streamOptions.signal === undefined ? {} : { signal: streamOptions.signal }),
                });
                if (!response.ok) {
                    const detail = (await response.text()).trim();
                    throw new Error(
                        detail.length === 0
                            ? `Gym inference failed with HTTP ${response.status}.`
                            : `Gym inference failed with HTTP ${response.status}: ${detail}`,
                    );
                }

                const reply = (await response.json()) as GymInferenceResponse;
                if (reply.delayMs !== undefined) {
                    await delay(reply.delayMs, streamOptions);
                }
                const stopReason =
                    reply.stopReason ??
                    (reply.content.some((block) => block.type === "toolCall") ? "toolUse" : "stop");
                const message: AssistantMessage = {
                    api: "gym",
                    content: [],
                    model: model.id,
                    provider: providerId,
                    role: "assistant",
                    ...(reply.responseModel === undefined
                        ? {}
                        : { responseModel: reply.responseModel }),
                    stopReason,
                    timestamp: Date.now(),
                    usage: reply.usage ?? zeroUsage(),
                    ...(reply.errorMessage === undefined
                        ? {}
                        : { errorMessage: reply.errorMessage }),
                };
                yield { type: "start", partial: message };

                for (const block of reply.content) {
                    const contentIndex = message.content.length;
                    message.content = [...message.content, block];
                    yield* eventsForBlock(
                        contentIndex,
                        message,
                        block,
                        reply.toolCallDeltaDelayMs,
                        streamOptions,
                    );
                }

                if (stopReason === "error" || stopReason === "aborted") {
                    const event: AssistantMessageEvent = {
                        type: "error",
                        reason: stopReason,
                        error: message,
                    };
                    yield event;
                    return message;
                }

                const event: AssistantMessageEvent = {
                    type: "done",
                    reason: stopReason,
                    message,
                };
                yield event;
                return message;
            });
        },
    });
}

async function* eventsForBlock(
    contentIndex: number,
    message: AssistantMessage,
    block: AssistantMessage["content"][number],
    toolCallDeltaDelayMs: number | undefined,
    streamOptions: StreamOptions,
): AsyncGenerator<AssistantMessageEvent> {
    if (block.type === "text") {
        yield { type: "text_start", contentIndex, partial: message };
        yield { type: "text_delta", contentIndex, delta: block.text, partial: message };
        yield { type: "text_end", contentIndex, content: block.text, partial: message };
        return;
    }
    if (block.type === "thinking") {
        yield { type: "thinking_start", contentIndex, partial: message };
        yield { type: "thinking_delta", contentIndex, delta: block.thinking, partial: message };
        yield {
            type: "thinking_end",
            contentIndex,
            content: block.thinking,
            partial: message,
        };
        return;
    }
    yield { type: "toolcall_start", contentIndex, partial: message };
    if (toolCallDeltaDelayMs !== undefined) {
        await delay(toolCallDeltaDelayMs, streamOptions);
    }
    yield {
        type: "toolcall_delta",
        contentIndex,
        delta: JSON.stringify(block.arguments),
        partial: message,
    };
    yield { type: "toolcall_end", contentIndex, toolCall: block, partial: message };
}

function zeroUsage(): Usage {
    return {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
    };
}

async function delay(ms: number, options: StreamOptions): Promise<void> {
    if (ms <= 0) return;
    await new Promise<void>((resolve, reject) => {
        const finish = () => {
            options.signal?.removeEventListener("abort", abort);
            resolve();
        };
        const timer = setTimeout(finish, ms);
        const abort = () => {
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", abort);
            reject(options.signal?.reason ?? new Error("Gym inference was aborted."));
        };
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
    });
}
