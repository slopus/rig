import type { SubmitMessageRequest } from "../protocol/index.js";

export function isSubmitMessageRequest(value: unknown): value is SubmitMessageRequest {
    if (
        !(
            value !== null &&
            typeof value === "object" &&
            typeof (value as { text?: unknown }).text === "string"
        )
    )
        return false;
    const request = value as Record<string, unknown>;
    if (
        request.systemPrompt !== undefined &&
        request.systemPrompt !== null &&
        typeof request.systemPrompt !== "string"
    )
        return false;
    if (typeof request.systemPrompt === "string" && request.systemPrompt.length > 262_144) {
        return false;
    }
    if (request.externalTools === undefined) return true;
    if (!Array.isArray(request.externalTools) || request.externalTools.length > 128) return false;
    const names = new Set<string>();
    for (const candidate of request.externalTools) {
        if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
            return false;
        }
        const tool = candidate as Record<string, unknown>;
        if (
            typeof tool.name !== "string" ||
            tool.name.length === 0 ||
            tool.name.length > 128 ||
            typeof tool.description !== "string" ||
            tool.description.length > 8_192 ||
            (tool.label !== undefined && typeof tool.label !== "string") ||
            tool.parameters === null ||
            typeof tool.parameters !== "object" ||
            Array.isArray(tool.parameters) ||
            names.has(tool.name)
        )
            return false;
        if (JSON.stringify(tool.parameters).length > 262_144) return false;
        names.add(tool.name);
    }
    return true;
}
