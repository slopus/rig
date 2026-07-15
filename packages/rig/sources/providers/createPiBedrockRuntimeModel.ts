import type { Model as PiModel } from "@earendil-works/pi-ai";

import type { BedrockModelRoute } from "./bedrock-model-routes.js";
import { resolveBedrockRuntimeModelId } from "./resolveBedrockRuntimeModelId.js";

export function createPiBedrockRuntimeModel(
    route: BedrockModelRoute,
    region: string,
    endpoint?: string,
): PiModel<"bedrock-converse-stream"> {
    return {
        id: resolveBedrockRuntimeModelId(route, region),
        name: route.model.name,
        api: "bedrock-converse-stream",
        provider: "bedrock",
        baseUrl: endpoint ?? `https://bedrock-runtime.${region}.amazonaws.com`,
        reasoning: route.reasoningMode !== "unsupported",
        input: [...route.input],
        cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
        },
        contextWindow: route.contextWindow,
        maxTokens: route.maxTokens,
    };
}
