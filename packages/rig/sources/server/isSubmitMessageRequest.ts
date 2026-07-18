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
    const names = new Set<string>();
    if (request.externalTools !== undefined) {
        if (!Array.isArray(request.externalTools) || request.externalTools.length > 128)
            return false;
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
    }
    if (request.skills === undefined) return true;
    if (!Array.isArray(request.skills) || request.skills.length > 128) return false;
    if (request.skills.length > 0 && names.has("read_skill")) return false;
    names.clear();
    for (const candidate of request.skills) {
        if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
            return false;
        }
        const skill = candidate as Record<string, unknown>;
        if (
            typeof skill.name !== "string" ||
            !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(skill.name) ||
            skill.name.length > 64 ||
            typeof skill.description !== "string" ||
            skill.description.trim().length === 0 ||
            skill.description.length > 1_024 ||
            skill.location !== "durable" ||
            names.has(skill.name)
        ) {
            return false;
        }
        names.add(skill.name);
    }
    return true;
}
