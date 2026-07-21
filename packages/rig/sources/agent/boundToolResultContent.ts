import type { ContentBlock } from "./types.js";
import type { ToolResultContent } from "../providers/types.js";

export const TOOL_RESULT_MAXIMUM_TEXT_BYTES = 50 * 1024;
export const TOOL_RESULT_MAXIMUM_BLOCKS = 128;
export const TOOL_RESULT_MAXIMUM_IMAGE_BLOCKS = 4;
export const TOOL_RESULT_MAXIMUM_IMAGE_BASE64_BYTES = 5 * 1024 * 1024;

const RESULT_TRUNCATION_NOTICE = "[Tool result truncated to fit the model context.]";

export interface ToolResultContentBounds {
    maximumTextBytes?: number;
    maximumBlocks?: number;
    maximumImageBlocks?: number;
    maximumImageBase64Bytes?: number;
}

export function boundToolResultContent(
    blocks: readonly ContentBlock[],
    bounds?: ToolResultContentBounds,
): readonly ContentBlock[];
export function boundToolResultContent(
    blocks: readonly ToolResultContent[],
    bounds?: ToolResultContentBounds,
): readonly ToolResultContent[];
export function boundToolResultContent(
    blocks: readonly (ContentBlock | ToolResultContent)[],
    bounds: ToolResultContentBounds = {},
): readonly (ContentBlock | ToolResultContent)[] {
    const maximumTextBytes = bounds.maximumTextBytes ?? TOOL_RESULT_MAXIMUM_TEXT_BYTES;
    const maximumBlocks = bounds.maximumBlocks ?? TOOL_RESULT_MAXIMUM_BLOCKS;
    const maximumImageBlocks = bounds.maximumImageBlocks ?? TOOL_RESULT_MAXIMUM_IMAGE_BLOCKS;
    const maximumImageBase64Bytes =
        bounds.maximumImageBase64Bytes ?? TOOL_RESULT_MAXIMUM_IMAGE_BASE64_BYTES;
    const bounded: Array<ContentBlock | ToolResultContent> = [];
    let imageBlocks = 0;
    let omittedImages = 0;
    let index = 0;

    for (; index < blocks.length; index += 1) {
        if (bounded.length >= maximumBlocks - 1 && index < blocks.length - 1) break;
        const block = blocks[index];
        if (block === undefined) continue;
        if (block.type === "text") {
            bounded.push(block);
            continue;
        }
        if (
            imageBlocks >= maximumImageBlocks ||
            Buffer.byteLength(block.data, "utf8") > maximumImageBase64Bytes
        ) {
            omittedImages += 1;
            continue;
        }
        bounded.push(block);
        imageBlocks += 1;
    }

    const contentTruncated = index < blocks.length;
    if ((contentTruncated || omittedImages > 0) && bounded.length >= maximumBlocks) {
        const removed = bounded.pop();
        if (removed?.type === "image") omittedImages += 1;
    }

    const notices: string[] = [];
    if (contentTruncated) notices.push(RESULT_TRUNCATION_NOTICE);
    if (omittedImages > 0) {
        notices.push(
            `[${String(omittedImages)} tool-result image${omittedImages === 1 ? " was" : "s were"} omitted because the image size or count limit was exceeded.]`,
        );
    }
    if (notices.length > 0) {
        bounded.push({ type: "text", text: notices.join("\n") });
    }

    const totalTextBytes = bounded.reduce(
        (total, block) => total + (block.type === "text" ? Buffer.byteLength(block.text) : 0),
        0,
    );
    if (totalTextBytes <= maximumTextBytes) return bounded;

    const marker = utf8Prefix(`\n\n${RESULT_TRUNCATION_NOTICE}`, maximumTextBytes);
    let remainingBytes = maximumTextBytes - Buffer.byteLength(marker);
    const textBounded: Array<ContentBlock | ToolResultContent> = [];
    for (const block of bounded) {
        if (block.type === "image") {
            textBounded.push(block);
            continue;
        }
        if (remainingBytes <= 0) continue;
        const text = utf8Prefix(block.text, remainingBytes);
        if (text.length === 0) continue;
        textBounded.push({ type: "text", text });
        remainingBytes -= Buffer.byteLength(text);
    }
    if (marker.length > 0) textBounded.push({ type: "text", text: marker });
    return textBounded;
}

function utf8Prefix(value: string, maximumBytes: number): string {
    if (Buffer.byteLength(value) <= maximumBytes) return value;
    const buffer = Buffer.from(value, "utf8");
    let end = Math.min(buffer.length, maximumBytes);
    while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80) end -= 1;
    return buffer.subarray(0, end).toString("utf8");
}
