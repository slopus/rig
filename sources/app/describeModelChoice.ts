import type { Model } from "../providers/types.js";
import { humanizeProviderId } from "./humanizeProviderId.js";
import { humanizeReasoningLevel } from "./humanizeReasoningLevel.js";

export function describeModelChoice(
  model: Model,
  providerId: string,
  isCurrent: boolean,
): string {
  const providerName = humanizeProviderId(providerId);
  return [
    isCurrent ? "Current model" : `${providerName} model`,
    `Default reasoning: ${humanizeReasoningLevel(model.defaultThinkingLevel)}`,
  ].join(" • ");
}
