import type { ThinkingLevel } from "@mariozechner/pi-ai";

export function toPiReasoningLevel(effort: string): ThinkingLevel | undefined {
    if (effort === "off") {
        return undefined;
    }
    if (effort === "max") {
        return "xhigh";
    }
    if (
        effort === "minimal" ||
        effort === "low" ||
        effort === "medium" ||
        effort === "high" ||
        effort === "xhigh"
    ) {
        return effort;
    }

    return undefined;
}
