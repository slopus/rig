type BedrockConversePayload = Record<string, unknown> & {
    additionalModelRequestFields?: Record<string, unknown>;
};

export function applyBedrockGlmThinking(
    payload: unknown,
    effort: string,
    supportsEffort: boolean,
): unknown {
    if (typeof payload !== "object" || payload === null) {
        return payload;
    }

    const request = payload as BedrockConversePayload;
    const thinkingEnabled = effort !== "off";
    return {
        ...request,
        additionalModelRequestFields: {
            ...request.additionalModelRequestFields,
            thinking: {
                type: thinkingEnabled ? "enabled" : "disabled",
            },
            ...(supportsEffort && thinkingEnabled
                ? { reasoning_effort: effort === "high" ? "high" : "max" }
                : {}),
        },
    };
}
