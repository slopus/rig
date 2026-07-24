import { isCodexV2Model } from "@/vendors/codex/impl/isCodexV2Model.js";

export function createCodexRequestHeaders(
    model: string,
    turnState: string | undefined,
    windowId: string,
    turnMetadata: string | undefined,
    useResponsesLite = isCodexV2Model(model),
): Record<string, string> {
    return {
        "x-codex-window-id": windowId,
        ...(turnMetadata === undefined ? {} : { "x-codex-turn-metadata": turnMetadata }),
        ...(useResponsesLite ? { "x-openai-internal-codex-responses-lite": "true" } : {}),
        ...(turnState === undefined ? {} : { "x-codex-turn-state": turnState }),
    };
}
