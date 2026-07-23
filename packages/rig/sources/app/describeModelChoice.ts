import type { Model } from "@slopus/rig-execution";
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
            ? "Unavailable while running"
            : isCurrent
              ? "Current model"
              : `${providerName} model`,
        `Default reasoning: ${humanizeReasoningLevel(model.defaultThinkingLevel)}`,
    ].join(" • ");
}
