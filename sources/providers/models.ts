/**
 * Curated model catalog for ohmypi defaults.
 *
 * Order matches the Conductor model picker.
 */

import { defineModel } from "./types.js";

export const modelAnthropicFable5 = defineModel({
  id: "anthropic/fable-5",
  name: "Fable 5",
  thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max"],
});

export const modelAnthropicOpus48 = defineModel({
  id: "anthropic/opus-4-8",
  name: "Opus 4.8 1M",
  thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max"],
});

export const modelAnthropicOpus47 = defineModel({
  id: "anthropic/opus-4-7",
  name: "Opus 4.7 1M",
  thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max"],
});

export const modelAnthropicOpus46 = defineModel({
  id: "anthropic/opus-4-6",
  name: "Opus 4.6 1M",
  thinkingLevels: ["off", "low", "medium", "high", "max"],
});

export const modelAnthropicSonnet461m = defineModel({
  id: "anthropic/sonnet-4-6-1m",
  name: "Sonnet 4.6 1M",
  thinkingLevels: ["off", "low", "medium", "high", "max"],
});

export const modelAnthropicSonnet46 = defineModel({
  id: "anthropic/sonnet-4-6",
  name: "Sonnet 4.6",
  thinkingLevels: ["off", "low", "medium", "high", "max"],
});

export const modelAnthropicHaiku45 = defineModel({
  id: "anthropic/haiku-4-5",
  name: "Haiku 4.5",
  thinkingLevels: ["off"],
});

export const modelOpenaiGpt55 = defineModel({
  id: "openai/gpt-5.5",
  name: "GPT-5.5",
  thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
});

export const modelOpenaiGpt54 = defineModel({
  id: "openai/gpt-5.4",
  name: "GPT-5.4",
  thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
});
