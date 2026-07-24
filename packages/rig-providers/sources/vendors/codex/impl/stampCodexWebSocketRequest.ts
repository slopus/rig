import { isCodexV2Model } from "@/vendors/codex/impl/isCodexV2Model.js";
import type { CodexResponseRequest } from "@/vendors/codex/impl/CodexResponseRequest.js";

export function stampCodexWebSocketRequest(
    request: Readonly<CodexResponseRequest>,
    turnState?: string,
): CodexResponseRequest {
    const stamped: CodexResponseRequest = structuredClone(request);
    const clientMetadata =
        typeof stamped.client_metadata === "object" &&
        stamped.client_metadata !== null &&
        !Array.isArray(stamped.client_metadata)
            ? (stamped.client_metadata as Record<string, unknown>)
            : {};
    clientMetadata["x-codex-ws-stream-request-start-ms"] = Date.now().toString();
    if (turnState !== undefined) clientMetadata["x-codex-turn-state"] = turnState;
    if (isCodexV2Model(String(stamped.model)) && stamped.tools === undefined) {
        clientMetadata.ws_request_header_x_openai_internal_codex_responses_lite = "true";
    }
    stamped.client_metadata = clientMetadata;
    return stamped;
}
