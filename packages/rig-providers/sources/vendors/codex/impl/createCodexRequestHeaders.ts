import { isCodexV2Model } from "@/vendors/codex/impl/isCodexV2Model.js";

export function createCodexRequestHeaders(
    model: string,
    turnState: string | undefined,
    windowId: string,
    turnMetadata: string | undefined,
): Record<string, string> {
    return {
        "x-codex-window-id": windowId,
        ...(turnMetadata === undefined ? {} : { "x-codex-turn-metadata": turnMetadata }),
        ...(isCodexV2Model(model) ? { "x-openai-internal-codex-responses-lite": "true" } : {}),
        ...(turnState === undefined ? {} : { "x-codex-turn-state": turnState }),
    };
}
