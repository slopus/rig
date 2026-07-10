type BedrockConversePayload = Record<string, unknown> & {
    additionalModelRequestFields?: Record<string, unknown>;
};

export function applyBedrockAdaptiveThinking(payload: unknown, effort: string): unknown {
    if (effort === "off" || typeof payload !== "object" || payload === null) {
        return payload;
    }

    const request = payload as BedrockConversePayload;
    return {
        ...request,
        additionalModelRequestFields: {
            ...request.additionalModelRequestFields,
            thinking: {
                type: "adaptive",
                display: "summarized",
            },
            output_config: { effort },
        },
    };
}
