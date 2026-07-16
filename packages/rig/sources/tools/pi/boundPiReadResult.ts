import type { ReadFileResult } from "../utils/file.js";
import { truncateTextHead } from "../utils/truncateTextHead.js";
import { createPiReadContinuationSuffix } from "./createPiReadContinuationSuffix.js";

export function boundPiReadResult(
    result: ReadFileResult,
    options: {
        maxBytes: number;
        maxLines: number;
        includeContinuationNotice: boolean;
    },
): ReadFileResult {
    const initial = truncateTextHead(result.content, options);
    const needsNotice = options.includeContinuationNotice || initial.truncated;
    if (!needsNotice) return result;

    let contentBudget = options.maxBytes;
    let truncation = initial;
    for (let attempt = 0; attempt < 4; attempt++) {
        const suffix = createPiReadContinuationSuffix(
            result,
            truncation.outputLines,
            options.maxBytes,
        );
        const nextContentBudget = Math.min(
            contentBudget,
            Math.max(0, options.maxBytes - Buffer.byteLength(suffix, "utf8")),
        );
        if (nextContentBudget === contentBudget) break;
        contentBudget = nextContentBudget;
        truncation = truncateTextHead(result.content, {
            maxBytes: contentBudget,
            maxLines: options.maxLines,
        });
        const firstLine = result.content.split("\n", 1)[0] ?? "";
        if (truncation.outputLines === 1 && Buffer.byteLength(firstLine, "utf8") > contentBudget) {
            truncation = { ...truncation, content: "", outputBytes: 0, outputLines: 0 };
        }
    }

    const suffix = createPiReadContinuationSuffix(result, truncation.outputLines, options.maxBytes);
    const content =
        truncation.content.length === 0 ? suffix.slice(2) : `${truncation.content}${suffix}`;
    return {
        ...result,
        content,
        returnedLines: truncation.outputLines,
        truncated: true,
    };
}
