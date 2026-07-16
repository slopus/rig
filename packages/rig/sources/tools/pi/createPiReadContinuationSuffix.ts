import type { ReadFileResult } from "../utils/file.js";

export function createPiReadContinuationSuffix(
    result: ReadFileResult,
    outputLines: number,
    maxBytes: number,
): string {
    if (outputLines === 0) {
        return `\n\n[Line ${result.startLine} exceeds the ${Math.floor(maxBytes / 1024)}KB limit. Use bash to inspect it.]`;
    }

    const endLine = result.startLine + outputLines - 1;
    return `\n\n[Showing lines ${result.startLine}-${endLine} of ${result.totalLines}. Use offset=${endLine + 1} to continue.]`;
}
