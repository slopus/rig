import { type AssistantMessageEventStream, type BedrockOptions } from "@mariozechner/pi-ai";
import { bedrockProviderModule } from "@mariozechner/pi-ai/bedrock-provider";

import type { BedrockModelRoute } from "./bedrock-model-routes.js";
import { applyBedrockAdaptiveThinking } from "./applyBedrockAdaptiveThinking.js";
import { applyBedrockGlmThinking } from "./applyBedrockGlmThinking.js";
import { applyBedrockKimiThinking } from "./applyBedrockKimiThinking.js";
import { createPiBedrockRuntimeModel } from "./createPiBedrockRuntimeModel.js";
import { toPiContext } from "./pi-bridge.js";
import { toPiReasoningLevel } from "./toPiReasoningLevel.js";
import type { Context, StreamOptions } from "./types.js";

export type PiBedrockRuntimeStream = typeof bedrockProviderModule.streamBedrock;

export function createBedrockRuntimeStream(options: {
    bearerToken: string;
    context: Context;
    modelRoute: BedrockModelRoute;
    region: string;
    stream?: PiBedrockRuntimeStream;
    streamOptions?: StreamOptions;
}): AssistantMessageEventStream {
    const stream = options.stream ?? bedrockProviderModule.streamBedrock;
    const model = createPiBedrockRuntimeModel(options.modelRoute, options.region);
    const effort = options.streamOptions?.thinking ?? options.modelRoute.model.defaultThinkingLevel;
    const streamOptions: BedrockOptions = {
        bearerToken: options.bearerToken,
        region: options.region,
        maxTokens: Math.min(options.modelRoute.maxTokens, 32_000),
        ...(options.streamOptions?.signal !== undefined
            ? { signal: options.streamOptions.signal }
            : {}),
        ...(options.streamOptions?.sessionId !== undefined
            ? { sessionId: options.streamOptions.sessionId }
            : {}),
    };

    if (options.modelRoute.reasoningMode === "adaptive" && effort !== "off") {
        streamOptions.onPayload = (payload) => applyBedrockAdaptiveThinking(payload, effort);
    } else if (options.modelRoute.reasoningMode === "kimi-toggle") {
        streamOptions.onPayload = (payload) => applyBedrockKimiThinking(payload, effort);
    } else if (
        options.modelRoute.reasoningMode === "glm-effort" ||
        options.modelRoute.reasoningMode === "glm-toggle"
    ) {
        streamOptions.onPayload = (payload) =>
            applyBedrockGlmThinking(
                payload,
                effort,
                options.modelRoute.reasoningMode === "glm-effort",
            );
    } else {
        const reasoning = toPiReasoningLevel(effort);
        if (reasoning !== undefined) {
            streamOptions.reasoning = reasoning;
        }
    }

    return stream(model, toPiContext(options.context), streamOptions);
}
