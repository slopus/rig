type BedrockConversePayload = Record<string, unknown> & {
    additionalModelRequestFields?: Record<string, unknown>;
};

export function applyBedrockKimiThinking(payload: unknown, effort: string): unknown {
    if (typeof payload !== "object" || payload === null) {
        return payload;
    }

    const request = payload as BedrockConversePayload;
    return {
        ...request,
        additionalModelRequestFields: {
            ...request.additionalModelRequestFields,
            thinking: {
                type: effort === "off" ? "disabled" : "enabled",
            },
        },
    };
}
