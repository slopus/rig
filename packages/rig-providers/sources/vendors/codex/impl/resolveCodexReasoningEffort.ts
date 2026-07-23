import type { SessionReasoningEffort } from "@/core/SessionRunRequest.js";
import { getCodexModelProperties } from "@/vendors/codex/impl/getCodexModelProperties.js";

export function resolveCodexReasoningEffort(
    model: string,
    effort: SessionReasoningEffort | undefined,
): SessionReasoningEffort {
    if (effort !== undefined) return effort;
    const resolved = getCodexModelProperties(model)?.defaultEffort;
    if (resolved === undefined) {
        throw new Error(`A reasoning effort is required for unrecognized Codex model '${model}'.`);
    }
    return resolved;
}
