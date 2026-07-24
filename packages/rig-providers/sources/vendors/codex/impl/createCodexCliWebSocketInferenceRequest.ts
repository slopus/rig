import type { CodexResponseRequest } from "@/vendors/codex/impl/CodexResponseRequest.js";
import { isCodexV2Model } from "@/vendors/codex/impl/isCodexV2Model.js";
import { responseInputItems } from "@/vendors/codex/impl/responseInputItems.js";

export function createCodexCliWebSocketInferenceRequest(
    request: CodexResponseRequest,
): CodexResponseRequest {
    if (!isCodexV2Model(String(request.model)) || request.tools !== undefined) return request;
    const inference = structuredClone(request);
    const input = responseInputItems(inference.input);
    const instructionIndex = input.findIndex(
        (item) =>
            typeof item === "object" &&
            item !== null &&
            (item as { role?: unknown }).role === "developer",
    );
    if (instructionIndex >= 0) input.splice(instructionIndex, 1);
    inference.input = input;
    return inference;
}
