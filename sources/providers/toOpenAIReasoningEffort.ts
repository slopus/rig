import type { ReasoningEffort } from "openai/resources/shared.js";

export function toOpenAIReasoningEffort(effort: string): ReasoningEffort | undefined {
    if (effort === "off") {
        return "none";
    }
    if (
        effort === "minimal" ||
        effort === "low" ||
        effort === "medium" ||
        effort === "high" ||
        effort === "xhigh" ||
        effort === "max"
    ) {
        return effort;
    }

    return undefined;
}
