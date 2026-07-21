import {
    boundToolResultContent,
    TOOL_RESULT_MAXIMUM_TEXT_BYTES,
} from "./boundToolResultContent.js";
import type { ToolResultBlock } from "./types.js";

export const TOOL_RESULTS_MAXIMUM_BATCH_TEXT_BYTES = 200 * 1024;
export const TOOL_RESULTS_MAXIMUM_BATCH_IMAGE_BLOCKS = 4;

export function boundToolResultBlocks(
    blocks: readonly ToolResultBlock[],
): readonly ToolResultBlock[] {
    let remainingImages = TOOL_RESULTS_MAXIMUM_BATCH_IMAGE_BLOCKS;
    const imageBounded = blocks.map((block) => {
        const rendered = boundToolResultContent(block.rendered, {
            maximumImageBlocks: remainingImages,
        });
        remainingImages -= rendered.filter((content) => content.type === "image").length;
        return rendered === block.rendered ? block : { ...block, rendered };
    });
    const textSizes = imageBounded.map((block) => textBytes(block));
    const textBudgets = allocateTextBudgets(textSizes, TOOL_RESULTS_MAXIMUM_BATCH_TEXT_BYTES);

    return imageBounded.map((block, index) => {
        const maximumTextBytes = Math.min(TOOL_RESULT_MAXIMUM_TEXT_BYTES, textBudgets[index] ?? 0);
        if (textSizes[index] === maximumTextBytes) return block;
        return {
            ...block,
            rendered: boundToolResultContent(block.rendered, { maximumTextBytes }),
        };
    });
}

function allocateTextBudgets(sizes: readonly number[], maximumBytes: number): readonly number[] {
    const budgets = Array.from({ length: sizes.length }, () => 0);
    let remainingBytes = maximumBytes;
    let pending = sizes.map((size, index) => ({ index, size }));

    while (pending.length > 0) {
        const equalShare = Math.floor(remainingBytes / pending.length);
        const fitting = pending.filter(({ size }) => size <= equalShare);
        if (fitting.length === 0) {
            for (const { index } of pending) budgets[index] = equalShare;
            let remainder = remainingBytes - equalShare * pending.length;
            for (const { index } of pending) {
                if (remainder === 0) break;
                budgets[index] = (budgets[index] ?? 0) + 1;
                remainder -= 1;
            }
            break;
        }

        const fittingIndexes = new Set(fitting.map(({ index }) => index));
        for (const { index, size } of fitting) {
            budgets[index] = size;
            remainingBytes -= size;
        }
        pending = pending.filter(({ index }) => !fittingIndexes.has(index));
    }

    return budgets;
}

function textBytes(block: ToolResultBlock): number {
    return block.rendered.reduce(
        (total, content) => total + (content.type === "text" ? Buffer.byteLength(content.text) : 0),
        0,
    );
}
