import { truncateTextTail } from "./truncateTextTail.js";

export const SHELL_CAPTURE_MAX_BYTES = 512_000;
export const SHELL_OUTPUT_MAX_BYTES = 50 * 1024;
export const SHELL_OUTPUT_MAX_LINES = 2_000;

const SHELL_TRUNCATION_NOTICE_MAX = `\n\n[Earlier output was truncated; showing the last ${SHELL_OUTPUT_MAX_LINES} lines (${(
    SHELL_OUTPUT_MAX_BYTES / 1024
).toFixed(1)}KB).]`;
const SHELL_TRUNCATION_NOTICE_MAX_BYTES = Buffer.byteLength(SHELL_TRUNCATION_NOTICE_MAX, "utf8");

export function boundShellOutput(value: string): string {
    const truncated = truncateTextTail(value, {
        maxBytes: SHELL_OUTPUT_MAX_BYTES - SHELL_TRUNCATION_NOTICE_MAX_BYTES,
        maxLines: SHELL_OUTPUT_MAX_LINES - 2,
    });
    return truncated.truncated
        ? `${truncated.content}\n\n[Earlier output was truncated; showing the last ${truncated.outputLines} lines (${(truncated.outputBytes / 1024).toFixed(1)}KB).]`
        : truncated.content;
}
