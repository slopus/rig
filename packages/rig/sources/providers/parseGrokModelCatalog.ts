import { defineModel, type Model } from "./types.js";

const REASONING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const LEGACY_REASONING_LEVELS = ["low", "medium", "high", "xhigh"] as const;

type GrokThinkingLevel = (typeof REASONING_LEVELS)[number];

export function parseGrokModelCatalog(value: unknown): readonly Model[] {
    const entries = catalogEntries(value);
    const models: Model[] = [];
    for (const entry of entries) {
        const source = objectValue(entry.info) ?? entry;
        const model = stringValue(source.model) ?? stringValue(source.id);
        if (model === undefined || model.trim().length === 0) continue;
        if (source.hidden === true) continue;
        const apiBackend = stringValue(source.api_backend) ?? stringValue(source.apiBackend);
        if (apiBackend !== undefined && apiBackend !== "responses") continue;

        const options = Array.isArray(source.reasoning_efforts)
            ? source.reasoning_efforts
            : Array.isArray(source.reasoningEfforts)
              ? source.reasoningEfforts
              : [];
        const configuredLevels = new Set<GrokThinkingLevel>(
            options.flatMap((option) => {
                const object = objectValue(option);
                const level = object === undefined ? undefined : parseThinkingLevel(object.value);
                return level === undefined ? [] : [level];
            }),
        );
        const supportsReasoning =
            source.supports_reasoning_effort === true || source.supportsReasoningEffort === true;
        const thinkingLevels = supportsReasoning
            ? configuredLevels.size === 0
                ? LEGACY_REASONING_LEVELS
                : REASONING_LEVELS.filter((level) => configuredLevels.has(level))
            : (["off"] as const);
        if (thinkingLevels.length === 0) continue;

        const configuredDefault = parseThinkingLevel(
            source.reasoning_effort ?? source.reasoningEffort,
        );
        const optionDefault = options.find((option) => objectValue(option)?.default === true);
        const optionDefaultValue =
            optionDefault === undefined
                ? undefined
                : parseThinkingLevel(objectValue(optionDefault)?.value);
        const requestedDefault = configuredDefault ?? optionDefaultValue ?? "medium";
        const defaultThinkingLevel: GrokThinkingLevel = thinkingLevels.some(
            (level) => level === requestedDefault,
        )
            ? requestedDefault
            : thinkingLevels[0];
        const contextWindow =
            numberValue(source.context_window) ?? numberValue(source.contextWindow);
        models.push(
            defineModel({
                id: `xai/${model}`,
                name: stringValue(source.name) ?? model,
                thinkingLevels,
                defaultThinkingLevel,
                ...(contextWindow === undefined || contextWindow <= 0 ? {} : { contextWindow }),
            }),
        );
    }
    return models;
}

function catalogEntries(value: unknown): Array<Record<string, unknown>> {
    const root = objectValue(value);
    if (root === undefined) return [];
    const data = root.data;
    if (Array.isArray(data)) return data.flatMap((entry) => objectEntries(entry));
    const models = root.models;
    if (Array.isArray(models)) return models.flatMap((entry) => objectEntries(entry));
    const modelMap = objectValue(models);
    return modelMap === undefined
        ? []
        : Object.values(modelMap).flatMap((entry) => objectEntries(entry));
}

function objectEntries(value: unknown): Array<Record<string, unknown>> {
    const object = objectValue(value);
    return object === undefined ? [] : [object];
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
    return value !== null && !Array.isArray(value) && typeof value === "object"
        ? (value as Record<string, unknown>)
        : undefined;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseThinkingLevel(value: unknown): GrokThinkingLevel | undefined {
    const level = stringValue(value);
    if (level === "none") return "off";
    return REASONING_LEVELS.find((candidate) => candidate === level);
}
