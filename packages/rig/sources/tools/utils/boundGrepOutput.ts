import { truncateLine } from "./truncateLine.js";
import { truncateTextHead } from "./truncateTextHead.js";

export const GREP_OUTPUT_DEFAULT_LIMIT = 100;
export const GREP_OUTPUT_MAX_BYTES = 50 * 1024;
export const GREP_OUTPUT_MAX_LINE_LENGTH = 500;

export function boundGrepOutput(value: string): string {
    let linesTruncated = false;
    const compactOutput = value
        .split("\n")
        .map((line) => {
            const truncated = truncateLine(line, GREP_OUTPUT_MAX_LINE_LENGTH);
            if (truncated.wasTruncated) linesTruncated = true;
            return truncated.text;
        })
        .join("\n");
    const notices: string[] = [];
    if (linesTruncated) {
        notices.push(
            `Some lines truncated to ${GREP_OUTPUT_MAX_LINE_LENGTH} chars. Use read tool to see full lines`,
        );
    }
    let noticeSuffix = notices.length === 0 ? "" : `\n\n[${notices.join(". ")}]`;
    if (
        Buffer.byteLength(compactOutput, "utf8") + Buffer.byteLength(noticeSuffix, "utf8") >
        GREP_OUTPUT_MAX_BYTES
    ) {
        notices.unshift(`${GREP_OUTPUT_MAX_BYTES / 1024}KB limit reached`);
        noticeSuffix = `\n\n[${notices.join(". ")}]`;
    }
    const contentBudget = GREP_OUTPUT_MAX_BYTES - Buffer.byteLength(noticeSuffix, "utf8");
    const truncation = truncateTextHead(compactOutput, {
        maxBytes: contentBudget,
        maxLines: Number.MAX_SAFE_INTEGER,
    });
    return `${truncation.content}${noticeSuffix}`;
}
