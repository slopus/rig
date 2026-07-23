import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import type { SessionTool } from "@/core/SessionTool.js";
import { isCodexV2Model } from "@/vendors/codex/impl/isCodexV2Model.js";
import { toCodexToolDefinitions } from "@/vendors/codex/impl/toCodexToolDefinitions.js";

export function createCodexCliSseRequest(
    request: ResponseCreateParamsStreaming,
    tools: readonly SessionTool[],
): ResponseCreateParamsStreaming {
    if (!isCodexV2Model(String(request.model))) return request;
    const sseRequest = structuredClone(request);
    sseRequest.input = [
        {
            type: "additional_tools",
            role: "developer",
            tools: toCodexToolDefinitions(tools),
        },
        ...(sseRequest.input as unknown[]),
    ] as never;
    return sseRequest;
}
