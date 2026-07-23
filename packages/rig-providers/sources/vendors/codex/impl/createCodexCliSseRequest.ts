import type { SessionTool } from "@/core/SessionTool.js";
import type { CodexResponseRequest } from "@/vendors/codex/impl/CodexResponseRequest.js";
import { isCodexV2Model } from "@/vendors/codex/impl/isCodexV2Model.js";
import { responseInputItems } from "@/vendors/codex/impl/responseInputItems.js";
import { toCodexToolDefinitions } from "@/vendors/codex/impl/toCodexToolDefinitions.js";

export function createCodexCliSseRequest(
    request: CodexResponseRequest,
    tools: readonly SessionTool[],
): CodexResponseRequest {
    if (!isCodexV2Model(String(request.model))) return request;
    const sseRequest = structuredClone(request);
    sseRequest.input = [
        {
            type: "additional_tools",
            role: "developer",
            tools: toCodexToolDefinitions(tools),
        },
        ...responseInputItems(sseRequest.input),
    ];
    return sseRequest;
}
