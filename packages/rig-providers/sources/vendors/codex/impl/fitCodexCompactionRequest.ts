import type {
    ResponseCreateParamsStreaming,
    ResponseInputItem,
} from "openai/resources/responses/responses.js";

import type { SessionTool } from "@/core/SessionTool.js";
import { createCodexCliSseRequest } from "@/vendors/codex/impl/createCodexCliSseRequest.js";
import { estimateCodexContextTokens } from "@/vendors/codex/impl/estimateCodexContextTokens.js";
import { truncateCodexText } from "@/vendors/codex/impl/truncateCodexText.js";

const TRUNCATED_TOOL_OUTPUT = "Output exceeded the available model context and was truncated";

/** Fits a compaction request to the hard model window without mutating durable context. */
export function fitCodexCompactionRequest(
    request: ResponseCreateParamsStreaming,
    tools: readonly SessionTool[],
    contextWindow: number,
): ResponseCreateParamsStreaming {
    const fitted = structuredClone(request);
    let input = [...(fitted.input as ResponseInputItem[])];
    fitted.input = input;

    for (let index = input.length - 1; index >= 0; index -= 1) {
        if (estimate(fitted, tools, contextWindow) < contextWindow) break;
        const item = input[index] as Record<string, any>;
        if (item.type === "function_call_output" || item.type === "custom_tool_call_output") {
            input[index] = { ...item, output: TRUNCATED_TOOL_OUTPUT } as ResponseInputItem;
        } else if (item.type === "tool_search_output") {
            input[index] = { ...item, tools: [] } as unknown as ResponseInputItem;
        }
    }

    while (estimate(fitted, tools, contextWindow) >= contextWindow) {
        const lastUser = input.findLast(
            (item) =>
                typeof item === "object" &&
                item !== null &&
                (item as { role?: unknown }).role === "user",
        );
        const removableIndex = input.findIndex((item) => {
            if (item === lastUser || typeof item !== "object" || item === null) return false;
            const candidate = item as { role?: unknown; type?: unknown };
            return (
                candidate.role !== "developer" &&
                candidate.type !== "additional_tools" &&
                candidate.type !== "compaction_trigger"
            );
        });
        if (removableIndex === -1) break;
        const removed = input[removableIndex] as { call_id?: unknown };
        const callId = typeof removed.call_id === "string" ? removed.call_id : undefined;
        input = input.filter(
            (item, index) =>
                index !== removableIndex &&
                (callId === undefined ||
                    typeof item !== "object" ||
                    item === null ||
                    (item as { call_id?: unknown }).call_id !== callId),
        );
        fitted.input = input;
    }

    while (estimate(fitted, tools, contextWindow) >= contextWindow) {
        const item = input.findLast(
            (candidate) =>
                typeof candidate === "object" &&
                candidate !== null &&
                (candidate as { role?: unknown }).role === "user",
        ) as Record<string, any> | undefined;
        if (item === undefined) break;
        const text = messageText(item);
        if (text === undefined || Buffer.byteLength(text) === 0) break;
        const estimateTokens = estimate(fitted, tools, Number.MAX_SAFE_INTEGER);
        const textTokens = Math.ceil(Buffer.byteLength(text) / 4);
        const targetTokens = Math.max(0, textTokens - (estimateTokens - contextWindow) - 256);
        if (targetTokens >= textTokens) break;
        replaceMessageText(item, truncateCodexText(text, targetTokens));
        if (estimate(fitted, tools, Number.MAX_SAFE_INTEGER) >= estimateTokens) break;
    }

    return fitted;
}

function estimate(
    request: ResponseCreateParamsStreaming,
    tools: readonly SessionTool[],
    limit: number,
): number {
    return estimateCodexContextTokens(createCodexCliSseRequest(request, tools), limit);
}

function messageText(item: Record<string, any>): string | undefined {
    if (typeof item.content === "string") return item.content;
    if (!Array.isArray(item.content)) return undefined;
    const content = item.content.find(
        (part: unknown) =>
            typeof part === "object" &&
            part !== null &&
            typeof (part as { text?: unknown }).text === "string",
    ) as { text: string } | undefined;
    return content?.text;
}

function replaceMessageText(item: Record<string, any>, text: string): void {
    if (typeof item.content === "string") {
        item.content = text;
        return;
    }
    if (!Array.isArray(item.content)) return;
    const content = item.content.find(
        (part: unknown) =>
            typeof part === "object" &&
            part !== null &&
            typeof (part as { text?: unknown }).text === "string",
    ) as { text: string } | undefined;
    if (content !== undefined) content.text = text;
}
