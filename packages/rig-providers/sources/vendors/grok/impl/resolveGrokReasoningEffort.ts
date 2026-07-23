import type { ReasoningEffort } from "openai/resources/shared.js";

import type { SessionReasoningEffort } from "@/core/SessionRunRequest.js";
import { toOpenAIReasoningEffort } from "@/vendors/grok/impl/toOpenAIReasoningEffort.js";

export function resolveGrokReasoningEffort(
    apiModelId: string,
    effort: SessionReasoningEffort | undefined,
): ReasoningEffort | undefined {
    if (apiModelId === "grok-composer-2.5-fast" || effort === undefined) return undefined;
    return toOpenAIReasoningEffort(effort);
}
