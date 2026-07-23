import type { ResponseInputItem } from "openai/resources/responses/responses.js";

import type { SessionContext } from "@/core/SessionContext.js";
import type { SessionReasoningEffort, SessionServiceTier } from "@/core/SessionRunRequest.js";
import type { SessionSkill } from "@/core/SessionSkill.js";
import type { SessionTool } from "@/core/SessionTool.js";
import { createOpenAIResponseRequest } from "@/responses/createOpenAIResponseRequest.js";
import type { CodexResponseRequest } from "@/vendors/codex/impl/CodexResponseRequest.js";
import { isCodexV2Model } from "@/vendors/codex/impl/isCodexV2Model.js";
import { setCodexRequestKind } from "@/vendors/codex/impl/setCodexRequestKind.js";
import { toCodexToolDefinitions } from "@/vendors/codex/impl/toCodexToolDefinitions.js";
import { withCodexSkills } from "@/vendors/codex/impl/withCodexSkills.js";
import { responseInputItems } from "@/vendors/codex/impl/responseInputItems.js";

export function createCodexCliRequest(options: {
    context: SessionContext;
    clientMetadata: Readonly<Record<string, string>>;
    effort?: SessionReasoningEffort;
    model: string;
    promptCacheKey: string;
    skills: readonly SessionSkill[];
    serviceTier?: SessionServiceTier;
    tools: readonly SessionTool[];
}): CodexResponseRequest {
    const request: CodexResponseRequest = createOpenAIResponseRequest({
        ...options,
        context: withCodexSkills(options.context, options.skills, options.model),
    });
    request.tool_choice = "auto";
    request.client_metadata = { ...options.clientMetadata };
    if (options.serviceTier !== undefined) request.service_tier = options.serviceTier;
    if (isCodexV2Model(options.model)) {
        request.parallel_tool_calls = false;
        if (request.reasoning !== undefined)
            request.reasoning = { ...request.reasoning, context: "all_turns" };
        delete request.instructions;
        request.input = [
            {
                type: "message",
                role: "developer",
                content: [{ type: "input_text", text: options.context.instructions }],
            },
            ...responseInputItems(request.input),
        ];
        delete request.tools;
    } else {
        request.parallel_tool_calls = true;
        request.tools = toCodexToolDefinitions(options.tools) as never;
    }
    return request;
}

export function createCodexCliWarmupRequest(
    request: CodexResponseRequest,
    tools: readonly SessionTool[],
): CodexResponseRequest {
    const warmup: CodexResponseRequest = structuredClone(request);
    setCodexRequestKind(warmup, "prewarm");
    warmup.generate = false;
    const model = String(warmup.model);
    if (isCodexV2Model(model)) {
        const instructions = responseInputItems(warmup.input).filter(
            (item) =>
                typeof item === "object" &&
                item !== null &&
                (item as { role?: unknown }).role === "developer",
        );
        const warmupInput: ResponseInputItem[] = [
            {
                type: "additional_tools",
                role: "developer",
                tools: toCodexToolDefinitions(tools),
            },
            ...instructions.slice(0, 1),
        ];
        warmup.input = warmupInput;
    } else {
        warmup.input = [];
    }
    return warmup;
}
