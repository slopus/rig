import type { ContentBlock } from "../agent/types.js";
import { boundedJsonStringify } from "../app/boundedJsonStringify.js";
import { truncateUtf8BytesForDisplay } from "../app/truncateUtf8BytesForDisplay.js";
import { MCP_RESULT_MAXIMUM_TEXT_BYTES } from "./mcpResultMaximumTextBytes.js";

const MAXIMUM_RESULT_BLOCKS = 128;
const MAXIMUM_IMAGE_BLOCKS = 4;
const MAXIMUM_IMAGE_BASE64_BYTES = 5 * 1024 * 1024;

interface ResultBudget {
    imageBlocks: number;
    remainingTextBytes: number;
}

export function mcpResultToContentBlocks(result: unknown): readonly ContentBlock[] {
    if (!isRecord(result)) {
        return [
            {
                type: "text",
                text: truncateUtf8BytesForDisplay(String(result), MCP_RESULT_MAXIMUM_TEXT_BYTES),
            },
        ];
    }
    const blocks: ContentBlock[] = [];
    const budget: ResultBudget = {
        imageBlocks: 0,
        remainingTextBytes: MCP_RESULT_MAXIMUM_TEXT_BYTES,
    };
    if (Array.isArray(result.content)) {
        let index = 0;
        for (; index < result.content.length && blocks.length < MAXIMUM_RESULT_BLOCKS; index += 1) {
            const candidates = contentToBlocks(result.content[index]);
            for (const candidate of candidates) {
                appendWithinBudget(blocks, candidate, budget);
                if (blocks.length >= MAXIMUM_RESULT_BLOCKS) break;
            }
            if (budget.remainingTextBytes === 0) break;
        }
        if (index < result.content.length) {
            appendWithinBudget(blocks, { type: "text", text: "... [truncated]" }, budget);
        }
    }
    if (blocks.length > 0) return blocks;
    if (result.structuredContent !== undefined) {
        return [
            {
                type: "text",
                text: boundedJsonStringify(result.structuredContent, MCP_RESULT_MAXIMUM_TEXT_BYTES),
            },
        ];
    }
    return [{ type: "text", text: "(empty result)" }];
}

function appendWithinBudget(
    blocks: ContentBlock[],
    block: ContentBlock,
    budget: ResultBudget,
): void {
    if (block.type === "text") {
        if (budget.remainingTextBytes === 0) return;
        const text = truncateUtf8BytesForDisplay(block.text, budget.remainingTextBytes);
        if (text.length === 0) return;
        blocks.push({ type: "text", text });
        budget.remainingTextBytes -= Buffer.byteLength(text);
        return;
    }
    if (block.data.length > MAXIMUM_IMAGE_BASE64_BYTES) {
        appendWithinBudget(
            blocks,
            {
                type: "text",
                text: "The MCP tool returned an image that exceeded the size limit.",
            },
            budget,
        );
        return;
    }
    if (budget.imageBlocks >= MAXIMUM_IMAGE_BLOCKS) {
        appendWithinBudget(
            blocks,
            { type: "text", text: "Additional MCP images were truncated." },
            budget,
        );
        return;
    }
    blocks.push(block);
    budget.imageBlocks += 1;
}

function contentToBlocks(content: unknown): ContentBlock[] {
    if (!isRecord(content) || typeof content.type !== "string") return [];
    if (content.type === "text" && typeof content.text === "string") {
        return [{ type: "text", text: content.text }];
    }
    if (
        content.type === "image" &&
        typeof content.data === "string" &&
        typeof content.mimeType === "string"
    ) {
        return [{ type: "image", data: content.data, mediaType: content.mimeType }];
    }
    if (content.type === "resource" && isRecord(content.resource)) {
        if (typeof content.resource.text === "string") {
            return [{ type: "text", text: content.resource.text }];
        }
        return [
            {
                type: "text",
                text: `MCP resource: ${typeof content.resource.uri === "string" ? content.resource.uri : "embedded content"}`,
            },
        ];
    }
    if (content.type === "resource_link") {
        return [
            {
                type: "text",
                text: `MCP resource: ${typeof content.uri === "string" ? content.uri : "linked content"}`,
            },
        ];
    }
    if (content.type === "audio") {
        return [{ type: "text", text: "The MCP tool returned audio content." }];
    }
    return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
