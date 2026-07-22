import type { ModelProfile } from "./types.js";

export function codexBedrockReferenceClient(options: {
    defaultThinkingLevel: string;
    thinkingLevels: readonly string[];
}): NonNullable<ModelProfile["parameters"]["referenceClient"]> {
    return {
        defaultThinkingLevel: options.defaultThinkingLevel,
        thinkingLevels: options.thinkingLevels,
        request: {
            applyPatchToolType: "freeform",
            defaultReasoningSummary: "none",
            defaultVerbosity: "low",
            multiAgentVersion: "v1",
            parallelToolCalls: true,
            supportsSearchTool: true,
            toolMode: null,
            useResponsesLite: false,
        },
    };
}
