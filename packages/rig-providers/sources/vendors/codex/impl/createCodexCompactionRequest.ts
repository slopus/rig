import type {
    ResponseCreateParamsStreaming,
    ResponseInputItem,
} from "openai/resources/responses/responses.js";

import type { CodexCompactionMetadata } from "@/vendors/codex/impl/CodexCompactionMetadata.js";
import { setCodexRequestKind } from "@/vendors/codex/impl/setCodexRequestKind.js";

export function createCodexCompactionRequest(
    request: ResponseCreateParamsStreaming,
    metadata: CodexCompactionMetadata,
): ResponseCreateParamsStreaming {
    const compaction = structuredClone(request);
    setCodexRequestKind(compaction as unknown as Record<string, unknown>, "compaction", metadata);
    compaction.input = [
        ...(compaction.input as ResponseInputItem[]),
        { type: "compaction_trigger" },
    ];
    return compaction;
}
