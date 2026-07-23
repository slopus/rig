import type { CodexCompactionMetadata } from "@/vendors/codex/impl/CodexCompactionMetadata.js";
import type { CodexResponseRequest } from "@/vendors/codex/impl/CodexResponseRequest.js";

export function setCodexRequestKind(
    request: CodexResponseRequest,
    requestKind: "compaction" | "prewarm" | "turn",
    compaction?: CodexCompactionMetadata,
): void {
    if (
        typeof request.client_metadata !== "object" ||
        request.client_metadata === null ||
        Array.isArray(request.client_metadata)
    ) {
        return;
    }
    const clientMetadata = request.client_metadata;
    const encoded = clientMetadata["x-codex-turn-metadata"];
    if (typeof encoded !== "string") return;
    try {
        const parsed: unknown = JSON.parse(encoded);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
        const turnMetadata: Record<string, unknown> = { ...parsed };
        turnMetadata.request_kind = requestKind;
        if (requestKind === "compaction" && compaction !== undefined) {
            turnMetadata.compaction = compaction;
        } else {
            delete turnMetadata.compaction;
        }
        clientMetadata["x-codex-turn-metadata"] = JSON.stringify(turnMetadata);
    } catch {
        // Invalid caller-supplied metadata is left untouched.
    }
}
