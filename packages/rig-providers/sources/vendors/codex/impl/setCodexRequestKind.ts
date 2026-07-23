import type { CodexCompactionMetadata } from "@/vendors/codex/impl/CodexCompactionMetadata.js";

export function setCodexRequestKind(
    request: Record<string, unknown>,
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
    const clientMetadata = request.client_metadata as Record<string, unknown>;
    const encoded = clientMetadata["x-codex-turn-metadata"];
    if (typeof encoded !== "string") return;
    try {
        const turnMetadata = JSON.parse(encoded) as Record<string, unknown>;
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
