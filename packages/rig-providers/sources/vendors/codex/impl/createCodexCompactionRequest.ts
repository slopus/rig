import type {
    ResponseCreateParamsStreaming,
} from "openai/resources/responses/responses.js";

import type { CodexCompactionMetadata } from "@/vendors/codex/impl/CodexCompactionMetadata.js";
import type { CodexResponseRequest } from "@/vendors/codex/impl/CodexResponseRequest.js";
import { responseInputItems } from "@/vendors/codex/impl/responseInputItems.js";
import { setCodexRequestKind } from "@/vendors/codex/impl/setCodexRequestKind.js";

export function createCodexCompactionRequest(
    request: ResponseCreateParamsStreaming,
    metadata: CodexCompactionMetadata,
): CodexResponseRequest {
    const compaction: CodexResponseRequest = structuredClone(request);
    setCodexRequestKind(compaction, "compaction", metadata);
    compaction.input = [
        ...responseInputItems(compaction.input),
        { type: "compaction_trigger" },
    ];
    return compaction;
}
