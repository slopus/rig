import type { SessionReasoningEffort } from "@slopus/rig-providers";

export function resolveProfileDefaultEffort(
    defaultThinkingLevel: string,
): SessionReasoningEffort | undefined {
    if (defaultThinkingLevel === "ultra") return "max";
    if (
        defaultThinkingLevel === "off" ||
        defaultThinkingLevel === "minimal" ||
        defaultThinkingLevel === "low" ||
        defaultThinkingLevel === "medium" ||
        defaultThinkingLevel === "high" ||
        defaultThinkingLevel === "xhigh" ||
        defaultThinkingLevel === "max"
    ) {
        return defaultThinkingLevel;
    }
    return undefined;
}
