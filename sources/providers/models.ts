/**
 * Curated model catalog for rig defaults.
 *
 * Order matches the Conductor model picker.
 */

import { defineModel } from "./types.js";

export const modelAnthropicFable5 = defineModel({
    id: "anthropic/fable-5",
    name: "Fable 5",
    thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max"],
    defaultThinkingLevel: "medium",
});

export const modelAnthropicOpus48 = defineModel({
    id: "anthropic/opus-4-8",
    name: "Opus 4.8 1M",
    thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max"],
    defaultThinkingLevel: "medium",
});

export const modelAnthropicOpus47 = defineModel({
    id: "anthropic/opus-4-7",
    name: "Opus 4.7 1M",
    thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max"],
    defaultThinkingLevel: "medium",
});

export const modelAnthropicOpus46 = defineModel({
    id: "anthropic/opus-4-6",
    name: "Opus 4.6 1M",
    thinkingLevels: ["off", "low", "medium", "high", "max"],
    defaultThinkingLevel: "medium",
});

export const modelAnthropicSonnet5 = defineModel({
    id: "anthropic/sonnet-5",
    name: "Sonnet 5",
    thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max"],
    defaultThinkingLevel: "medium",
});

export const modelAnthropicSonnet461m = defineModel({
    id: "anthropic/sonnet-4-6-1m",
    name: "Sonnet 4.6 1M",
    thinkingLevels: ["off", "low", "medium", "high", "max"],
    defaultThinkingLevel: "medium",
});

export const modelAnthropicSonnet46 = defineModel({
    id: "anthropic/sonnet-4-6",
    name: "Sonnet 4.6",
    thinkingLevels: ["off", "low", "medium", "high", "max"],
    defaultThinkingLevel: "medium",
});

export const modelAnthropicHaiku45 = defineModel({
    id: "anthropic/haiku-4-5",
    name: "Haiku 4.5",
    thinkingLevels: ["off"],
    defaultThinkingLevel: "off",
});

export const modelOpenaiGpt55 = defineModel({
    id: "openai/gpt-5.5",
    name: "GPT-5.5",
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
    defaultThinkingLevel: "medium",
});

export const modelOpenaiGpt56Sol = defineModel({
    id: "openai/gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max", "ultra"],
    defaultThinkingLevel: "low",
});

export const modelOpenaiGpt56Terra = defineModel({
    id: "openai/gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max", "ultra"],
    defaultThinkingLevel: "medium",
});

export const modelOpenaiGpt56Luna = defineModel({
    id: "openai/gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max"],
    defaultThinkingLevel: "medium",
});

export const modelOpenaiGpt54 = defineModel({
    id: "openai/gpt-5.4",
    name: "GPT-5.4",
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
    defaultThinkingLevel: "medium",
});

export const modelMoonshotKimiK25 = defineModel({
    id: "moonshot/kimi-k2.5",
    name: "Kimi K2.5",
    thinkingLevels: ["off", "on"],
    defaultThinkingLevel: "on",
});

export const modelMoonshotKimiK2Thinking = defineModel({
    id: "moonshot/kimi-k2-thinking",
    name: "Kimi K2 Thinking",
    thinkingLevels: ["on"],
    defaultThinkingLevel: "on",
});

export const modelZaiGlm5 = defineModel({
    id: "zai/glm-5",
    name: "GLM 5",
    thinkingLevels: ["off", "high", "max"],
    defaultThinkingLevel: "max",
});

export const modelZaiGlm47 = defineModel({
    id: "zai/glm-4.7",
    name: "GLM 4.7",
    thinkingLevels: ["off", "on"],
    defaultThinkingLevel: "on",
});

export const modelZaiGlm47Flash = defineModel({
    id: "zai/glm-4.7-flash",
    name: "GLM 4.7 Flash",
    thinkingLevels: ["off", "on"],
    defaultThinkingLevel: "on",
});
