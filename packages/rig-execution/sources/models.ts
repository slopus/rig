/**
 * Curated model catalog for rig defaults.
 *
 * Order matches the Conductor model picker.
 */

import { defineModel } from "./types.js";

export const modelAnthropicFable5 = defineModel({
    id: "anthropic/fable-5",
    name: "Fable 5",
    thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max", "ultra"],
    defaultThinkingLevel: "medium",
    contextWindow: 1_000_000,
    autoCompactWindow: 200_000,
});

export const modelAnthropicOpus48 = defineModel({
    id: "anthropic/opus-4-8",
    name: "Opus 4.8 1M",
    thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max", "ultra"],
    defaultThinkingLevel: "medium",
    contextWindow: 1_000_000,
    autoCompactWindow: 200_000,
});

export const modelAnthropicOpus47 = defineModel({
    id: "anthropic/opus-4-7",
    name: "Opus 4.7 1M",
    thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max", "ultra"],
    defaultThinkingLevel: "medium",
    contextWindow: 1_000_000,
    autoCompactWindow: 200_000,
});

export const modelAnthropicOpus46 = defineModel({
    id: "anthropic/opus-4-6",
    name: "Opus 4.6 1M",
    thinkingLevels: ["off", "low", "medium", "high", "max"],
    defaultThinkingLevel: "medium",
    contextWindow: 1_000_000,
    autoCompactWindow: 200_000,
});

export const modelAnthropicSonnet5 = defineModel({
    id: "anthropic/sonnet-5",
    name: "Sonnet 5",
    thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max", "ultra"],
    defaultThinkingLevel: "medium",
    contextWindow: 1_000_000,
    autoCompactWindow: 200_000,
});

export const modelAnthropicSonnet461m = defineModel({
    id: "anthropic/sonnet-4-6-1m",
    name: "Sonnet 4.6 1M",
    thinkingLevels: ["off", "low", "medium", "high", "max"],
    defaultThinkingLevel: "medium",
    contextWindow: 1_000_000,
    autoCompactWindow: 200_000,
});

export const modelAnthropicSonnet46 = defineModel({
    id: "anthropic/sonnet-4-6",
    name: "Sonnet 4.6",
    thinkingLevels: ["off", "low", "medium", "high", "max"],
    defaultThinkingLevel: "medium",
    contextWindow: 200_000,
});

export const modelAnthropicHaiku45 = defineModel({
    id: "anthropic/haiku-4-5",
    name: "Haiku 4.5",
    thinkingLevels: ["off"],
    defaultThinkingLevel: "off",
    contextWindow: 200_000,
});

export const modelOpenaiGpt55 = defineModel({
    id: "openai/gpt-5.5",
    name: "GPT-5.5",
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
    defaultThinkingLevel: "medium",
    contextWindow: 272_000,
});

export const modelOpenaiGpt56Sol = defineModel({
    id: "openai/gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max", "ultra"],
    defaultThinkingLevel: "low",
    contextWindow: 372_000,
});

export const modelOpenaiGpt56Terra = defineModel({
    id: "openai/gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max", "ultra"],
    defaultThinkingLevel: "medium",
    contextWindow: 372_000,
});

export const modelOpenaiGpt56Luna = defineModel({
    id: "openai/gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max"],
    defaultThinkingLevel: "medium",
    contextWindow: 372_000,
});

export const modelOpenaiGpt54 = defineModel({
    id: "openai/gpt-5.4",
    name: "GPT-5.4",
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
    defaultThinkingLevel: "medium",
    contextWindow: 272_000,
});

export const modelXaiGrokBuild = defineModel({
    id: "xai/grok-build",
    name: "Grok Build",
    thinkingLevels: ["on"],
    defaultThinkingLevel: "on",
    contextWindow: 500_000,
});

export const modelXaiGrok45 = defineModel({
    id: "xai/grok-4.5",
    name: "Grok 4.5",
    thinkingLevels: ["low", "medium", "high"],
    defaultThinkingLevel: "high",
    contextWindow: 500_000,
});

export const modelXaiGrokComposer25Fast = defineModel({
    id: "xai/grok-composer-2.5-fast",
    name: "Composer 2.5",
    thinkingLevels: ["off"],
    defaultThinkingLevel: "off",
    contextWindow: 200_000,
});
