import type { Model } from "../providers/types.js";
import { humanizeProviderId } from "./humanizeProviderId.js";
import { humanizeReasoningLevel } from "./humanizeReasoningLevel.js";

export function describeModelChoice(
    model: Model,
    providerId: string,
    isCurrent: boolean,
    options: { locked?: boolean } = {},
): string {
    const providerName = humanizeProviderId(providerId);
    return [
        options.locked === true
            ? "Locked for this session"
            : isCurrent
              ? "Current model"
              : `${providerName} model`,
        `Default reasoning: ${humanizeReasoningLevel(model.defaultThinkingLevel)}`,
    ].join(" • ");
}
