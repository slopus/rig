import type { ContentBlock } from "../agent/types.js";
import type { ExternalToolCallResolution } from "./types.js";

export function externalToolResolutionToContent(
    resolution: ExternalToolCallResolution,
): readonly ContentBlock[] {
    if (resolution.status === "failed") {
        const details =
            resolution.error.data === undefined ? "" : `\n${stringify(resolution.error.data)}`;
        const code = resolution.error.code === undefined ? "" : ` (${resolution.error.code})`;
        return [{ type: "text", text: `${resolution.error.message}${code}${details}` }];
    }
    if (resolution.content !== undefined) return resolution.content;
    return [{ type: "text", text: stringify(resolution.output) }];
}

function stringify(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === undefined) return "External tool completed successfully.";
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
