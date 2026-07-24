import type { ResponseInputItem } from "openai/resources/responses/responses.js";

import type { SessionTool } from "@/core/SessionTool.js";
import type { CodexResponseRequest } from "@/vendors/codex/impl/CodexResponseRequest.js";
import { createCodexCliSseRequest } from "@/vendors/codex/impl/createCodexCliSseRequest.js";
import { estimateCodexContextTokens } from "@/vendors/codex/impl/estimateCodexContextTokens.js";
import { truncateCodexText } from "@/vendors/codex/impl/truncateCodexText.js";

const TRUNCATED_TOOL_OUTPUT = "Output exceeded the available model context and was truncated";

/** Fits a compaction request to the hard model window without mutating durable context. */
export function fitCodexCompactionRequest(
    request: CodexResponseRequest,
    tools: readonly SessionTool[],
    contextWindow: number,
): CodexResponseRequest {
    const fitted: CodexResponseRequest = structuredClone(request);
    let input = Array.isArray(fitted.input) ? [...fitted.input] : [];
    fitted.input = input;

    for (let index = input.length - 1; index >= 0; index -= 1) {
        if (estimate(fitted, tools, contextWindow) < contextWindow) break;
        const item = input[index];
        if (item === undefined) continue;
        if (item.type === "function_call_output" || item.type === "custom_tool_call_output") {
            input[index] = { ...item, output: TRUNCATED_TOOL_OUTPUT };
        } else if (item.type === "tool_search_output") {
            input[index] = { ...item, tools: [] };
        }
    }

    while (estimate(fitted, tools, contextWindow) >= contextWindow) {
        const lastUser = input.findLast((item) => "role" in item && item.role === "user");
        const removableIndex = input.findIndex((item) => {
            if (item === lastUser) return false;
            return (
                (!("role" in item) || item.role !== "developer") &&
                item.type !== "compaction_trigger"
            );
        });
        if (removableIndex === -1) break;
        const removed = input[removableIndex];
        const callId =
            removed !== undefined && "call_id" in removed && typeof removed.call_id === "string"
                ? removed.call_id
                : undefined;
        input = input.filter(
            (item, index) =>
                index !== removableIndex &&
                (callId === undefined || !("call_id" in item) || item.call_id !== callId),
        );
        fitted.input = input;
    }

    while (estimate(fitted, tools, contextWindow) >= contextWindow) {
        const item = input.findLast(
            (candidate) => "role" in candidate && candidate.role === "user",
        );
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
    request: CodexResponseRequest,
    tools: readonly SessionTool[],
    limit: number,
): number {
    return estimateCodexContextTokens(createCodexCliSseRequest(request, tools), limit);
}

function messageText(item: ResponseInputItem): string | undefined {
    if (!("content" in item)) return undefined;
    if (typeof item.content === "string") return item.content;
    if (!Array.isArray(item.content)) return undefined;
    const content = findTextContent(item.content);
    return content?.text;
}

function replaceMessageText(item: ResponseInputItem, text: string): void {
    if (!("content" in item)) return;
    if (typeof item.content === "string") {
        item.content = text;
        return;
    }
    if (!Array.isArray(item.content)) return;
    const content = findTextContent(item.content);
    if (content !== undefined) content.text = text;
}

function findTextContent(values: readonly unknown[]): { text: string } | undefined {
    for (const value of values) {
        if (hasText(value)) return value;
    }
    return undefined;
}

function hasText(value: unknown): value is { text: string } {
    return (
        typeof value === "object" &&
        value !== null &&
        "text" in value &&
        typeof value.text === "string"
    );
}
